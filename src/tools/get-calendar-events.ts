import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D2LApiClient, DEFAULT_CACHE_TTLS } from "../api/index.js";
import { fetchAllObjects } from "../api/paginate.js";
import { GetCalendarEventsSchema } from "./schemas.js";
import { toolResponse, sanitizeError } from "./tool-helpers.js";
import { resolveCourses, type CourseRef } from "./get-upcoming-due-dates.js";
import { log } from "../utils/logger.js";
import type { AppConfig } from "../types/index.js";

const DAY = 86_400_000;

interface EventDataInfo {
  CalendarEventId: number;
  OrgUnitId?: number;
  OrgUnitName?: string | null;
  Title: string;
  Description?: string | null;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  StartDay?: string | null;
  EndDay?: string | null;
  IsAllDayEvent?: boolean;
  LocationName?: string | null;
  AssociatedEntity?: { AssociatedEntityType?: string | null; AssociatedEntityId?: number | null; Link?: string | null } | null;
}

export interface CalendarEvent {
  id: number;
  title: string;
  courseId: number;
  courseName: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  /** What the event is attached to in Brightspace, e.g. a dropbox or quiz. Null for plain events like exams or classes. */
  linkedTo: string | null;
  link: string | null;
}

function eventStart(event: EventDataInfo): string | null {
  return event.StartDateTime ?? event.StartDay ?? null;
}

export function mapEvent(event: EventDataInfo, course: CourseRef): CalendarEvent {
  const description = event.Description?.trim();
  return {
    id: event.CalendarEventId,
    title: event.Title,
    courseId: course.id,
    courseName: course.name ?? event.OrgUnitName ?? null,
    start: eventStart(event),
    end: event.EndDateTime ?? event.EndDay ?? null,
    allDay: event.IsAllDayEvent === true,
    location: event.LocationName?.trim() || null,
    description: description ? description.slice(0, 1000) : null,
    linkedTo: event.AssociatedEntity?.AssociatedEntityType ?? null,
    link: event.AssociatedEntity?.Link ?? null,
  };
}

async function fetchCourseEvents(apiClient: D2LApiClient, course: CourseRef, from: string, to: string): Promise<EventDataInfo[]> {
  const path = apiClient.le(
    course.id,
    `/calendar/events/myEvents/?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}`,
  );
  // Older Brightspace versions return a bare array, newer ones a paged ObjectListPage.
  const first = await apiClient.get<unknown>(path, { ttl: DEFAULT_CACHE_TTLS.assignments });
  if (Array.isArray(first)) return first as EventDataInfo[];
  return fetchAllObjects<EventDataInfo>(apiClient, path, { ttl: DEFAULT_CACHE_TTLS.assignments });
}

export function registerGetCalendarEvents(server: McpServer, apiClient: D2LApiClient, config: AppConfig): void {
  server.registerTool(
    "get_calendar_events",
    {
      title: "Get Calendar Events",
      description:
        "Events from the Brightspace course calendar: exams, tests, labs, classes, office hours and other dated events " +
        "that instructors post, plus due-date events. Use this when the user asks when an exam or test is, what is on their " +
        "schedule, or what is happening on a day. For what work is left to hand in, use get_todo instead.",
      inputSchema: GetCalendarEventsSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args: unknown) => {
      try {
        const { daysAhead, daysBack, courseId, search } = GetCalendarEventsSchema.parse(args);
        const now = Date.now();
        const from = new Date(now - daysBack * DAY).toISOString();
        const to = new Date(now + daysAhead * DAY).toISOString();

        const courses = await resolveCourses(apiClient, config, courseId);
        const results = await Promise.allSettled(
          courses.map(async (course) => (await fetchCourseEvents(apiClient, course, from, to)).map((e) => mapEvent(e, course))),
        );

        let events = results.flatMap((result, index) => {
          if (result.status === "fulfilled") return result.value;
          log("DEBUG", `get_calendar_events: skipped course ${courses[index].id}`, result.reason);
          return [];
        });
        if (courseId && results[0]?.status === "rejected") throw results[0].reason;

        if (search) {
          const needle = search.toLowerCase();
          events = events.filter((e) => `${e.title} ${e.description ?? ""}`.toLowerCase().includes(needle));
        }

        const seen = new Set<string>();
        events = events
          .filter((e) => {
            const key = `${e.courseId}:${e.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => new Date(a.start ?? 0).getTime() - new Date(b.start ?? 0).getTime());

        log("INFO", `get_calendar_events: ${events.length} events across ${courses.length} courses`);
        return toolResponse({ from, to, count: events.length, events });
      } catch (error) {
        return sanitizeError(error);
      }
    },
  );
}
