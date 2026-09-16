import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D2LApiClient, DEFAULT_CACHE_TTLS } from "../api/index.js";
import { GetUpcomingDueDatesSchema } from "./schemas.js";
import { toolResponse, sanitizeError } from "./tool-helpers.js";
import { log } from "../utils/logger.js";
import { applyCourseFilter } from "../utils/course-filter.js";
import { assignmentUrl, quizUrl } from "../utils/deep-links.js";
import { fetchSubmissionStatus, type FolderDates, type SubmissionStatus } from "./submission-status.js";
import type { AppConfig } from "../types/index.js";

interface DropboxFolder extends FolderDates {
  Name: string;
  IsHidden: boolean;
}

interface QuizReadData {
  QuizId: number;
  Name: string;
  StartDate: string | null;
  EndDate: string | null;
  DueDate: string | null;
  IsActive: boolean;
}

interface EnrollmentItem {
  OrgUnit: { Id: number; Name: string; Code: string };
  Access: { IsActive: boolean; CanAccess?: boolean };
}

interface EnrollmentResponse {
  Items: EnrollmentItem[];
}

interface CourseRef {
  id: number;
  name: string | null;
}

export interface DueItem {
  type: "assignment" | "quiz";
  id: number;
  title: string;
  courseId: number;
  courseName: string | null;
  dueDate: string;
  startDate: string | null;
  endDate: string | null;
  url: string;
  submitted: boolean | null;
  submissionStatus: SubmissionStatus;
  statusNote?: string;
  submittedDate: string | null;
}

type CollectedItem = Omit<DueItem, "submitted" | "submissionStatus" | "submittedDate"> & { folder?: DropboxFolder };

function unwrapList<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : ((raw as { Objects?: T[] })?.Objects ?? []);
}

async function resolveCourses(apiClient: D2LApiClient, config: AppConfig, courseId?: number): Promise<CourseRef[]> {
  let items: EnrollmentItem[] = [];
  try {
    const response = await apiClient.get<EnrollmentResponse>(
      apiClient.lp("/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true"),
      { ttl: DEFAULT_CACHE_TTLS.enrollments }
    );
    items = response.Items ?? [];
  } catch (error) {
    if (!courseId) throw error;
    log("DEBUG", "due dates: could not fetch enrollments for course name", error);
  }

  if (courseId) {
    const match = items.find((item) => item.OrgUnit.Id === courseId);
    return [{ id: courseId, name: match?.OrgUnit.Name ?? null }];
  }

  const filtered = applyCourseFilter(
    items.map((item) => ({
      id: item.OrgUnit.Id,
      name: item.OrgUnit.Name,
      code: item.OrgUnit.Code,
      isActive: item.Access.IsActive,
      canAccess: item.Access.CanAccess,
    })),
    config.courseFilter
  );
  return filtered.map((course) => ({ id: course.id, name: course.name }));
}

async function fetchCourseDueItems(apiClient: D2LApiClient, baseUrl: string, course: CourseRef): Promise<CollectedItem[]> {
  const [dropboxResult, quizResult] = await Promise.allSettled([
    apiClient.get<unknown>(apiClient.le(course.id, "/dropbox/folders/"), { ttl: DEFAULT_CACHE_TTLS.assignments }),
    apiClient.get<unknown>(apiClient.le(course.id, "/quizzes/"), { ttl: DEFAULT_CACHE_TTLS.assignments }),
  ]);

  const items: CollectedItem[] = [];

  if (dropboxResult.status === "fulfilled") {
    for (const folder of unwrapList<DropboxFolder>(dropboxResult.value)) {
      if (folder.IsHidden === true || !folder.DueDate) continue;
      items.push({
        type: "assignment",
        id: folder.Id,
        title: folder.Name,
        courseId: course.id,
        courseName: course.name,
        dueDate: folder.DueDate,
        startDate: folder.Availability?.StartDate ?? null,
        endDate: folder.Availability?.EndDate ?? null,
        url: assignmentUrl(baseUrl, course.id, folder.Id),
        folder,
      });
    }
  } else {
    // 403 for past courses and similar: keep the other courses.
    log("DEBUG", `due dates: failed to fetch dropbox folders for course ${course.id}`, dropboxResult.reason);
  }

  if (quizResult.status === "fulfilled") {
    for (const quiz of unwrapList<QuizReadData>(quizResult.value)) {
      if (quiz.IsActive === false) continue;
      // Many instructors set only an End Date, which is the effective deadline.
      const dueDate = quiz.DueDate ?? quiz.EndDate;
      if (!dueDate) continue;
      items.push({
        type: "quiz",
        id: quiz.QuizId,
        title: quiz.Name,
        courseId: course.id,
        courseName: course.name,
        dueDate,
        startDate: quiz.StartDate ?? null,
        endDate: quiz.EndDate ?? null,
        url: quizUrl(baseUrl, course.id, quiz.QuizId),
      });
    }
  } else {
    log("DEBUG", `due dates: failed to fetch quizzes for course ${course.id}`, quizResult.reason);
  }

  return items;
}

export interface CollectOptions {
  fromMs: number;
  toMs: number;
  courseId?: number;
}

export async function collectDueItems(apiClient: D2LApiClient, config: AppConfig, options: CollectOptions): Promise<DueItem[]> {
  const now = Date.now();
  const courses = await resolveCourses(apiClient, config, options.courseId);
  const results = await Promise.allSettled(courses.map((course) => fetchCourseDueItems(apiClient, config.baseUrl, course)));
  const items = results.flatMap((result) => {
    if (result.status === "fulfilled") return result.value;
    log("DEBUG", "due dates: skipping course after fetch failure", result.reason);
    return [];
  });

  const inWindow = items
    .filter((item) => {
      const due = new Date(item.dueDate).getTime();
      return Number.isFinite(due) && due >= now + options.fromMs && due <= now + options.toMs;
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  return Promise.all(inWindow.map(async ({ folder, ...item }): Promise<DueItem> => {
    if (!folder) {
      return { ...item, submitted: null, submissionStatus: "unknown", statusNote: "Brightspace does not show students their quiz attempts.", submittedDate: null };
    }
    const summary = await fetchSubmissionStatus(apiClient, item.courseId, folder);
    return {
      ...item,
      submitted: summary.submitted,
      submissionStatus: summary.submissionStatus,
      ...(summary.statusNote ? { statusNote: summary.statusNote } : {}),
      submittedDate: summary.submission?.submittedDate ?? null,
    };
  }));
}

export function registerGetUpcomingDueDates(server: McpServer, apiClient: D2LApiClient, config: AppConfig): void {
  server.registerTool(
    "get_upcoming_due_dates",
    {
      title: "Get Upcoming Due Dates",
      description:
        "Upcoming due dates across all courses, with whether each assignment is already submitted " +
        "(submissionStatus: submitted, graded, draft, not_submitted, not_open_yet, closed, past_due, restricted, unknown). " +
        "Dates are UTC ISO strings; convert to the user's local time. Use for deadlines and what's due.",
      inputSchema: GetUpcomingDueDatesSchema,
    },
    async (args: unknown) => {
      try {
        const { daysAhead, courseId } = GetUpcomingDueDatesSchema.parse(args);
        const upcoming = await collectDueItems(apiClient, config, { fromMs: 0, toMs: daysAhead * 86_400_000, courseId });
        log("INFO", `get_upcoming_due_dates: ${upcoming.length} items`);
        return toolResponse(upcoming);
      } catch (error) {
        return sanitizeError(error);
      }
    }
  );
}
