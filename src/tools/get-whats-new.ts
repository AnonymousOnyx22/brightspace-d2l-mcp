import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D2LApiClient, DEFAULT_CACHE_TTLS } from "../api/index.js";
import { GetWhatsNewSchema } from "./schemas.js";
import { toolResponse, sanitizeError } from "./tool-helpers.js";
import { resolveCourses, type CourseRef } from "./get-upcoming-due-dates.js";
import { isPublishedNewsItem, mapNewsItem, newestFirst } from "./get-announcements.js";
import { gradebookUrl } from "../utils/deep-links.js";
import { log } from "../utils/logger.js";
import type { AppConfig } from "../types/index.js";

const DAY = 86_400_000;

interface UpdatesInfo {
  UnreadDiscussions?: number | null;
  UnattemptedQuizzes?: number | null;
  UnreadAssignmentFeedback?: number | null;
}

type NewsItem = Parameters<typeof mapNewsItem>[0];

export interface CourseUpdates {
  courseId: number;
  courseName: string | null;
  unreadFeedback: number | null;
  unreadDiscussions: number | null;
  unattemptedQuizzes: number | null;
  newAnnouncements: ReturnType<typeof mapNewsItem>[];
  gradesUrl: string;
}

export function hasAnything(course: CourseUpdates): boolean {
  return (
    (course.unreadFeedback ?? 0) > 0 ||
    (course.unreadDiscussions ?? 0) > 0 ||
    (course.unattemptedQuizzes ?? 0) > 0 ||
    course.newAnnouncements.length > 0
  );
}

function count(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function courseUpdates(
  apiClient: D2LApiClient,
  baseUrl: string,
  course: CourseRef,
  sinceMs: number,
): Promise<CourseUpdates> {
  const [updates, news] = await Promise.allSettled([
    apiClient.get<UpdatesInfo>(apiClient.le(course.id, "/updates/myUpdates/"), { ttl: DEFAULT_CACHE_TTLS.grades }),
    apiClient.get<NewsItem[]>(apiClient.le(course.id, "/news/"), { ttl: DEFAULT_CACHE_TTLS.announcements }),
  ]);
  if (updates.status === "rejected" && news.status === "rejected") throw updates.reason;

  const info = updates.status === "fulfilled" ? updates.value : {};
  const items = news.status === "fulfilled" && Array.isArray(news.value) ? news.value : [];
  const newAnnouncements = items
    .filter(isPublishedNewsItem)
    .map(mapNewsItem)
    .filter((item) => item.date !== null && new Date(item.date).getTime() >= sinceMs)
    .sort(newestFirst);

  return {
    courseId: course.id,
    courseName: course.name,
    unreadFeedback: count(info.UnreadAssignmentFeedback),
    unreadDiscussions: count(info.UnreadDiscussions),
    unattemptedQuizzes: count(info.UnattemptedQuizzes),
    newAnnouncements,
    gradesUrl: gradebookUrl(baseUrl, course.id),
  };
}

export function registerGetWhatsNew(server: McpServer, apiClient: D2LApiClient, config: AppConfig): void {
  server.registerTool(
    "get_whats_new",
    {
      title: "What's New",
      description:
        "One catch-up summary across all courses: new announcements, unread assignment feedback (newly marked work), " +
        "unread discussion posts and quizzes not attempted yet. Use this when the user asks what's new, what they missed, " +
        "whether anything was graded or posted, or for a daily or weekly catch-up.",
      inputSchema: GetWhatsNewSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args: unknown) => {
      try {
        const { sinceDays, courseId } = GetWhatsNewSchema.parse(args);
        const sinceMs = Date.now() - sinceDays * DAY;
        const courses = await resolveCourses(apiClient, config, courseId);

        const results = await Promise.allSettled(courses.map((course) => courseUpdates(apiClient, config.baseUrl, course, sinceMs)));
        const all = results.flatMap((result, index) => {
          if (result.status === "fulfilled") return [result.value];
          log("DEBUG", `get_whats_new: skipped course ${courses[index].id}`, result.reason);
          return [];
        });
        if (courseId && results[0]?.status === "rejected") throw results[0].reason;

        const withNews = all.filter(hasAnything);
        const sum = (pick: (c: CourseUpdates) => number | null) => all.reduce((total, c) => total + (pick(c) ?? 0), 0);

        return toolResponse({
          since: new Date(sinceMs).toISOString(),
          totals: {
            newAnnouncements: sum((c) => c.newAnnouncements.length),
            unreadFeedback: sum((c) => c.unreadFeedback),
            unreadDiscussions: sum((c) => c.unreadDiscussions),
            unattemptedQuizzes: sum((c) => c.unattemptedQuizzes),
          },
          guidance:
            "Lead with unread feedback (new marks) and announcements. Unread feedback means marked work the user has not opened; " +
            "use get_my_grades for the scores. Unattempted quizzes may include ones that are closed or optional. " +
            "Courses with nothing new are left out.",
          courses: withNews,
          quietCourses: all.filter((c) => !hasAnything(c)).map((c) => c.courseName ?? String(c.courseId)),
        });
      } catch (error) {
        return sanitizeError(error);
      }
    },
  );
}
