
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchSubmissionStatus } from "./submission-status.js";
import { D2LApiClient, DEFAULT_CACHE_TTLS } from "../api/index.js";
import { GetAssignmentsSchema } from "./schemas.js";
import { toolResponse, sanitizeError } from "./tool-helpers.js";
import { convertHtmlToMarkdown } from "../utils/html-converter.js";
import { log } from "../utils/logger.js";
import { applyCourseFilter } from "../utils/course-filter.js";
import { assignmentUrl, gradebookUrl, quizUrl } from "../utils/deep-links.js";
import type { AppConfig } from "../types/index.js";

// D2L Dropbox API types
interface DropboxFolder {
  Id: number;
  CategoryId: number | null;
  Name: string;
  CustomInstructions: { Text: string; Html: string } | null;
  DueDate: string | null;
  Availability?: { StartDate: string | null; EndDate: string | null } | null;
  IsHidden: boolean;
  Assessment: {
    ScoreDenominator: number | null;
    Rubrics: Array<{
      RubricId: number;
      Name: string;
      Criteria: Array<{
        CriterionId: number;
        Name: string;
        Levels: Array<{
          LevelId: number;
          Name: string;
          Points: number;
          Description: { Text: string; Html: string } | null;
        }>;
      }>;
    }>;
  } | null;
  GroupTypeId: number | null; // null = individual, non-null = group
  SubmissionType: number | null;
}

interface DropboxFeedback {
  Score: number | null;
  Feedback: { Text: string; Html: string } | null;
  RubricAssessments: any[];
}

// D2L Quiz API types
interface QuizRichText {
  Text?: { Text?: string | null; Html?: string | null } | string | null;
  Html?: string | null;
  IsDisplayed?: boolean;
}

interface QuizTimeLimit {
  IsEnforced: boolean;
  ShowClock: boolean;
  TimeLimitValue: number; // minutes
}

interface QuizReadData {
  QuizId: number;
  Name: string;
  Description: QuizRichText | null;
  Instructions?: QuizRichText | null;
  StartDate: string | null;
  EndDate: string | null;
  DueDate: string | null;
  IsActive: boolean;
  AttemptsAllowed: {
    IsUnlimited: boolean;
    NumberOfAttemptsAllowed: number | null;
  } | null;
  // The live field name. TimeLimit is the older flat spelling, kept so a
  // tenant that still sends it keeps working.
  SubmissionTimeLimit?: QuizTimeLimit | null;
  TimeLimit?: QuizTimeLimit | null;
  SubmissionGracePeriod?: number | null;
  Password?: string | null;
  ContentMetadataOnly?: boolean;
}

function richTextHtml(field: QuizRichText | null | undefined): string | null {
  if (!field) return null;
  const nested =
    typeof field.Text === "object" && field.Text !== null ? field.Text.Html : null;
  return nested ?? field.Html ?? null;
}

interface QuizAttemptData {
  AttemptId: number;
  AttemptNumber: number;
  Score: number | null;
  IsCompleted: boolean;
  CompletedDate: string | null;
}

interface EnrollmentItem {
  OrgUnit: {
    Id: number;
    Name: string;
    Code: string;
  };
  Access: {
    ClasslistRoleName: string;
    IsActive: boolean;
    CanAccess?: boolean;
    LastAccessed: string | null;
  };
}

interface EnrollmentResponse {
  Items: EnrollmentItem[];
  PagingInfo?: {
    HasMoreItems: boolean;
    Bookmark?: string;
  };
}

// D2L gradebook types
interface GradeObject {
  Id: number;
  Name: string;
  GradeObjectTypeId: number;
  AssociatedTool: { ToolId: number; ToolItemId: number } | null;
}

interface ContentQuizTopic {
  TopicId: number;
  Title: string;
  TypeIdentifier?: string;
  Url?: string;
  ActivityId?: string | null;
  ToolItemId?: number | null;
  ActivityType?: number;
  IsHidden?: boolean;
  IsBroken?: boolean;
  IsExempt?: boolean;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  DueDate?: string | null;
  Description?: QuizRichText | null;
}

interface ContentModule {
  Modules?: ContentModule[];
  Topics?: ContentQuizTopic[];
}

interface ContentTableOfContents {
  Modules?: ContentModule[];
}

const STUDENT_SCORED = new Set([1, 2, 3, 4]);

function missingContentQuizTopics(raw: unknown, listedIds: Set<number>): ContentQuizTopic[] {
  if (!raw || typeof raw !== "object") return [];

  const found = new Map<number, ContentQuizTopic>();
  const visit = (modules: ContentModule[] | undefined): void => {
    if (!Array.isArray(modules)) return;
    for (const module of modules) {
      for (const topic of module.Topics ?? []) {
        const isQuiz = topic.ActivityType === 4
          || topic.TypeIdentifier?.toLowerCase() === "quiz"
          || /(?:[?&]|&amp;)type=quiz(?:[&#]|$)/i.test(topic.Url ?? "");
        if (!isQuiz || topic.IsHidden || topic.IsBroken || topic.IsExempt) continue;

        const activityId = topic.ToolItemId ?? Number(topic.ActivityId);
        if (!Number.isSafeInteger(activityId) || activityId <= 0 || listedIds.has(activityId)) continue;
        if (!found.has(activityId)) found.set(activityId, topic);
      }
      visit(module.Modules);
    }
  };

  visit((raw as ContentTableOfContents).Modules);
  return [...found.values()];
}

async function recoverContentQuizzes(
  apiClient: D2LApiClient,
  courseId: number,
  toc: unknown,
  listedIds: Set<number>
): Promise<QuizReadData[]> {
  return Promise.all(missingContentQuizTopics(toc, listedIds).map(async (topic) => {
    const quizId = topic.ToolItemId ?? Number(topic.ActivityId);
    try {
      return await apiClient.get<QuizReadData>(apiClient.le(courseId, `/quizzes/${quizId}`), {
        ttl: DEFAULT_CACHE_TTLS.assignments,
      });
    } catch (error) {
      log("DEBUG", `Failed to fetch content-linked quiz ${quizId}: using content metadata`, error);
    }

    let detail = topic;
    try {
      detail = await apiClient.get<ContentQuizTopic>(
        apiClient.le(courseId, `/content/topics/${topic.TopicId}`),
        { ttl: DEFAULT_CACHE_TTLS.courseContent }
      );
    } catch (error) {
      log("DEBUG", `Failed to fetch content topic ${topic.TopicId}: using table-of-contents metadata`, error);
    }

    return {
      QuizId: quizId,
      Name: detail.Title || topic.Title,
      Description: detail.Description ?? null,
      StartDate: detail.StartDate ?? detail.StartDateTime ?? topic.StartDateTime ?? null,
      EndDate: detail.EndDate ?? detail.EndDateTime ?? topic.EndDateTime ?? null,
      DueDate: detail.DueDate ?? null,
      IsActive: true,
      AttemptsAllowed: null,
      ContentMetadataOnly: true,
    };
  }));
}

export async function fetchCourseAssignments(
  apiClient: D2LApiClient,
  courseId: number,
  baseUrl?: string
): Promise<any[]> {
  const assignments: any[] = [];

  const [dropboxResult, quizResult, gradebookResult, contentResult] = await Promise.allSettled([
    apiClient.get<{ Objects: DropboxFolder[] } | DropboxFolder[]>(
      apiClient.le(courseId, "/dropbox/folders/"),
      { ttl: DEFAULT_CACHE_TTLS.assignments }
    ),
    apiClient.get<{ Objects: QuizReadData[] } | QuizReadData[]>(
      apiClient.le(courseId, "/quizzes/"),
      { ttl: DEFAULT_CACHE_TTLS.assignments }
    ),
    apiClient.get<GradeObject[]>(apiClient.le(courseId, "/grades/"), {
      ttl: DEFAULT_CACHE_TTLS.assignments,
    }),
    apiClient.get<ContentTableOfContents>(apiClient.le(courseId, "/content/toc"), {
      ttl: DEFAULT_CACHE_TTLS.courseContent,
    }),
  ]);

  // Process Dropbox folders
  if (dropboxResult.status === "fulfilled") {
    // D2L dropbox endpoint may return paged { Objects: [...] } or flat array
    const dropboxRaw = dropboxResult.value;
    const folders: DropboxFolder[] = Array.isArray(dropboxRaw) ? dropboxRaw : (dropboxRaw as any).Objects ?? [];

    for (const folder of folders) {
      // Skip hidden folders
      if (folder.IsHidden) continue;

      const submissionStatus = await fetchSubmissionStatus(apiClient, courseId, folder);

      // Fetch feedback independently of submissions
      let feedback: DropboxFeedback | null = null;
      try {
        feedback = await apiClient.get<DropboxFeedback>(
          apiClient.le(courseId, `/dropbox/folders/${folder.Id}/feedback/myFeedback/`),
          { ttl: DEFAULT_CACHE_TTLS.assignments }
        );
      } catch (error: any) {
        // 404/403 means no feedback available (or no access) - that's fine
        if (error?.status !== 404 && error?.status !== 403) {
          log("DEBUG", `Failed to fetch feedback for folder ${folder.Id}`, error);
        }
      }

      // Build assignment object
      const assignment = {
        type: "assignment",
        id: folder.Id,
        name: folder.Name,
        url: baseUrl ? assignmentUrl(baseUrl, courseId, folder.Id) : null,
        instructions: folder.CustomInstructions?.Html
          ? convertHtmlToMarkdown(folder.CustomInstructions.Html)
          : { markdown: "", html: "" },
        dueDate: folder.DueDate,
        points: folder.Assessment?.ScoreDenominator ?? null,
        isGroup: folder.GroupTypeId !== null,
        rubric: folder.Assessment?.Rubrics?.map((r) => ({
          name: r.Name,
          criteria: r.Criteria?.map((c) => ({
            name: c.Name,
            levels: c.Levels?.map((l) => ({
              name: l.Name,
              points: l.Points,
              description: l.Description?.Text ?? null,
            })) ?? [],
          })) ?? [],
        })) ?? null,
        startDate: folder.Availability?.StartDate ?? null,
        endDate: folder.Availability?.EndDate ?? null,
        ...submissionStatus,
        feedback: feedback
          ? {
              score: feedback.Score,
              feedback: feedback.Feedback?.Html
                ? convertHtmlToMarkdown(feedback.Feedback.Html)
                : null,
            }
          : null,
      };

      assignments.push(assignment);
    }
  } else {
    // Log dropbox fetch failure but don't throw
    log("DEBUG", `Failed to fetch dropbox folders for course ${courseId}`, dropboxResult.reason);
  }

  // Process quizzes. Content discovery remains useful when the list route is
  // forbidden or unavailable, so a failed list starts from an empty set.
  let quizzes: QuizReadData[] = [];
  if (quizResult.status === "fulfilled") {
    const quizResponse = quizResult.value;
    // D2L quizzes API returns paged result { Objects: [...] } or a plain array
    quizzes = Array.isArray(quizResponse)
      ? quizResponse
      : (quizResponse as any)?.Objects ?? [];
  } else {
    log("DEBUG", `Failed to fetch quizzes for course ${courseId}`, quizResult.reason);
  }

  if (contentResult.status === "fulfilled") {
    const listedIds = new Set(quizzes.map((quiz) => quiz.QuizId));
    quizzes.push(...await recoverContentQuizzes(
      apiClient,
      courseId,
      contentResult.value,
      listedIds
    ));
  } else {
    log("DEBUG", `Failed to fetch course content for quiz discovery in course ${courseId}`, contentResult.reason);
  }

    let attemptsForbidden = false;

    for (const quiz of quizzes) {
      // Skip inactive quizzes
      if (!quiz.IsActive) continue;

      // Fetch quiz attempts. null means "not measured", which is different
      // from an empty list, and the output says which one it was.
      let attempts: QuizAttemptData[] | null = null;
      if (!attemptsForbidden && !quiz.ContentMetadataOnly) {
        try {
          const attemptsRaw = await apiClient.get<{ Objects: QuizAttemptData[] } | QuizAttemptData[]>(
            apiClient.le(courseId, `/quizzes/${quiz.QuizId}/attempts/`),
            { ttl: DEFAULT_CACHE_TTLS.assignments }
          );
          // D2L attempts endpoint may return paged { Objects: [...] } or flat array
          attempts = Array.isArray(attemptsRaw) ? attemptsRaw : (attemptsRaw as any).Objects ?? [];
        } catch (error: any) {
          if (error?.status === 404) {
            // 404 means no attempts yet, which is a measurement of zero
            attempts = [];
          } else if (error?.status === 403) {
            attemptsForbidden = true;
            log("DEBUG", `Attempts are forbidden for course ${courseId}: not asking again`);
          } else {
            log("DEBUG", `Failed to fetch attempts for quiz ${quiz.QuizId}`, error);
          }
        }
      }

      // Calculate remaining attempts
      const completedAttempts = attempts?.filter((a) => a.IsCompleted) ?? null;
      let attemptsRemaining: number | string | null = null;
      let attemptWarning: string | null = null;

      if (completedAttempts) {
        attemptsRemaining = "Unlimited";

        if (quiz.AttemptsAllowed && !quiz.AttemptsAllowed.IsUnlimited) {
          const allowed = quiz.AttemptsAllowed.NumberOfAttemptsAllowed ?? 0;
          attemptsRemaining = allowed - completedAttempts.length;

          // Generate warning for low attempts
          if (attemptsRemaining <= 0) {
            attemptWarning = "WARNING: No attempts remaining";
          } else if (attemptsRemaining === 1) {
            attemptWarning = "WARNING: Only 1 attempt remaining";
          }
        }
      }

      const timeLimit = quiz.SubmissionTimeLimit ?? quiz.TimeLimit;
      const descriptionHtml = richTextHtml(quiz.Description);

      // Build quiz object
      const quizAssignment = {
        type: "quiz",
        id: quiz.QuizId,
        name: quiz.Name,
        url: baseUrl ? quizUrl(baseUrl, courseId, quiz.QuizId) : null,
        instructions: descriptionHtml
          ? convertHtmlToMarkdown(descriptionHtml)
          : { markdown: "", html: "" },
        dueDate: quiz.DueDate,
        startDate: quiz.StartDate,
        endDate: quiz.EndDate,
        timeLimit: timeLimit?.IsEnforced ? timeLimit.TimeLimitValue : null,
        attemptsAllowed: quiz.AttemptsAllowed?.IsUnlimited
          ? "Unlimited"
          : quiz.AttemptsAllowed?.NumberOfAttemptsAllowed ?? null,
        // False when the tenant refused the attempts endpoint, in which case
        // every count below is null rather than a guess of zero.
        attemptsAvailable: completedAttempts !== null,
        attemptsUsed: completedAttempts?.length ?? null,
        attemptsRemaining,
        attemptWarning,
        bestScore: completedAttempts && completedAttempts.length > 0
          ? Math.max(...completedAttempts.map((a) => a.Score ?? 0))
          : null,
        gracePeriodMinutes: quiz.SubmissionGracePeriod ?? null,
        hasPassword: Boolean(quiz.Password),
      };

      assignments.push(quizAssignment);
  }

  // Process the gradebook last, once the fetched items are known.
  if (gradebookResult.status === "fulfilled") {
    assignments.push(
      ...gradebookHeadsUp(gradebookResult.value, assignments, courseId, baseUrl)
    );
  } else {
    log("DEBUG", `Failed to fetch the gradebook for course ${courseId}`, gradebookResult.reason);
  }

  return assignments;
}

function gradebookHeadsUp(
  raw: unknown,
  fetched: any[],
  courseId: number,
  baseUrl?: string
): any[] {
  if (!Array.isArray(raw)) return [];

  const covered = new Set(
    fetched.map((item) => item.id).filter((id) => typeof id === "number")
  );

  const rows: any[] = [];
  for (const column of raw as GradeObject[]) {
    if (!STUDENT_SCORED.has(column?.GradeObjectTypeId as number)) continue;
    if (covered.has(column.AssociatedTool?.ToolItemId as number)) continue;
    if (typeof column.Id !== "number" || typeof column.Name !== "string") continue;

    rows.push({
      type: "gradeOnly",
      id: column.Id,
      name: column.Name,
      // Always null: a grade column carries no due date of its own, and
      // inventing one from the column name would be a guess.
      dueDate: null,
      url: baseUrl ? gradebookUrl(baseUrl, courseId) : null,
    });
  }
  return rows;
}

export function registerGetAssignments(
  server: McpServer,
  apiClient: D2LApiClient,
  config: AppConfig
): void {
  server.registerTool(
    "get_assignments",
    {
      title: "Get Assignments",
      description:
        "Fetch assignments and quizzes for a specific course or all enrolled courses. Shows dropbox submissions and quizzes with due dates, status, and rubric info. Use this when the user asks about assignments, homework, what to submit, quizzes, or assignment details and rubrics.",
      inputSchema: GetAssignmentsSchema,
    },
    async (args: any) => {
      try {
        log("DEBUG", "get_assignments tool called", { args });

        // Parse and validate input
        const { courseId } = GetAssignmentsSchema.parse(args);

        // Single course case
        if (courseId) {
          const assignments = await fetchCourseAssignments(apiClient, courseId, config.baseUrl);

          log("INFO", `get_assignments: Retrieved ${assignments.length} assignments for course ${courseId}`);
          return toolResponse({ courseId, assignments });
        }

        // All courses case
        // First, fetch enrolled courses
        const enrollmentPath = apiClient.lp(
          "/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true"
        );
        const enrollmentResponse = await apiClient.get<EnrollmentResponse>(
          enrollmentPath,
          { ttl: DEFAULT_CACHE_TTLS.enrollments }
        );

        // Apply course filter
        const filteredEnrollments = applyCourseFilter(
          enrollmentResponse.Items.map(item => ({
            id: item.OrgUnit.Id,
            name: item.OrgUnit.Name,
            code: item.OrgUnit.Code,
            isActive: item.Access.IsActive,
            canAccess: item.Access.CanAccess,
            ...item,
          })),
          config.courseFilter
        );

        // Fetch assignments for each course (handle 403s gracefully)
        const assignmentPromises = filteredEnrollments.map(async (item) => {
          try {
            const assignments = await fetchCourseAssignments(apiClient, item.OrgUnit.Id, config.baseUrl);

            return {
              courseId: item.OrgUnit.Id,
              courseName: item.OrgUnit.Name,
              assignments,
            };
          } catch (error: any) {
            // 403 means no access (past course, etc) - log and skip
            if (error?.status === 403) {
              log(
                "DEBUG",
                `get_assignments: 403 Forbidden for course ${item.OrgUnit.Id} (${item.OrgUnit.Name}) - skipping`
              );
              return null;
            }
            throw error; // Re-throw other errors
          }
        });

        const results = await Promise.allSettled(assignmentPromises);
        const courses = results
          .filter(
            (r): r is PromiseFulfilledResult<any> =>
              r.status === "fulfilled" && r.value !== null
          )
          .map((r) => r.value);

        log(
          "INFO",
          `get_assignments: Retrieved assignments for ${courses.length} courses (out of ${enrollmentResponse.Items.length} enrolled)`
        );
        return toolResponse({ courses });
      } catch (error) {
        // Temporary: log full error details to stderr for debugging
        if (error instanceof Error) {
          log("ERROR", `get_assignments failed: ${error.message}\n${error.stack}`);
        }
        return sanitizeError(error);
      }
    }
  );
}
