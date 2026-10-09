
import { z } from "zod";


export const GetMyCoursesSchema = z.object({
  activeOnly: z
    .boolean()
    .optional()
    .describe(
      "Only return currently active courses. Defaults to the server's configured activeOnly setting (true unless overridden)."
    ),
});

export const GetUpcomingDueDatesSchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(90).default(7).describe("Number of days ahead to look for due dates"),
  courseId: z.coerce.number().int().positive().optional().describe("Filter to a specific course ID"),
});

export const GetTodoSchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(60).default(14).describe("How many days ahead to include"),
  includeOverdueDays: z.coerce.number().int().min(0).max(30).default(3).describe("Also include unfinished work that was due this many days ago"),
});

export const GetMyGradesSchema = z.object({
  courseId: z.coerce.number().int().positive().optional().describe("Course ID to get grades for. If omitted, returns grades for all enrolled courses."),
});

export const GetAnnouncementsSchema = z.object({
  courseId: z.coerce.number().int().positive().optional().describe("Course ID to get announcements for. If omitted, returns recent announcements across all courses."),
  count: z.coerce.number().int().min(1).max(50).default(10).describe("Maximum number of announcements to return"),
});

export const GetAssignmentsSchema = z.object({
  courseId: z.coerce.number().int().positive().optional()
    .describe("Course ID to get assignments for. If omitted, returns assignments for all enrolled courses."),
});

export const GetCourseContentSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID to get content tree for."),
  typeFilter: z.enum(["file", "link", "html", "video", "all"]).default("all").optional()
    .describe("Optional filter to narrow results by content type."),
  moduleTitle: z.string().optional()
    .describe("Case-insensitive substring match on module titles. Only returns modules whose title contains this string (e.g. 'Labs', 'Staff', 'Homeworks'). Children of matching modules are included in full."),
  maxDepth: z.coerce.number().int().min(1).max(10).optional()
    .describe("Limit recursive depth of the content tree. Depth 1 returns top-level modules with direct children only. Useful for getting a table of contents without all nested content."),
});

export const GetClasslistEmailsSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID to get emails for."),
});

export const DownloadFileSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID the file belongs to."),
  topicId: z.coerce.number().int().positive().optional()
    .describe("Content topic ID to download (for course content files)."),
  folderId: z.coerce.number().int().positive().optional()
    .describe("Dropbox folder ID (for submission/feedback file downloads)."),
  fileId: z.coerce.number().int().positive().optional()
    .describe("Specific file ID within a dropbox submission."),
  downloadPath: z.string().min(1)
    .describe("Absolute path to the directory where the file should be saved."),
  customFilename: z.string().max(255).optional()
    .describe("Custom filename for the downloaded file (include extension). If not provided, uses the original filename from Brightspace."),
});

export const GetSyllabusSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID to get syllabus for."),
  downloadPath: z.string().min(1).optional()
    .describe("Absolute path to the directory where the attachment should be saved."),
});

export const GetDiscussionsSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID to get discussion boards for."),
  forumId: z.coerce.number().int().positive().optional()
    .describe("Specific forum ID to get topics and posts for. If omitted, returns all forums."),
  topicId: z.coerce.number().int().positive().optional()
    .describe("Specific topic ID to get posts for. Requires forumId."),
});

export const GetAssignmentFilesSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID whose assignment attachments to look at."),
  folderId: z.coerce.number().int().positive().optional()
    .describe("Assignment (dropbox folder) ID. Omit to list every assignment in the course that has attachments."),
  fileId: z.coerce.number().int().positive().optional()
    .describe("Attachment file ID to read. Requires folderId. Omit to list the files without reading them."),
  extractText: z.boolean().default(true)
    .describe("Extract readable text from the file. Works for PDF, DOCX, XLSX, PPTX, and plain text."),
  maxChars: z.coerce.number().int().positive().max(100000).default(12000)
    .describe("Maximum characters of extracted text to return. The response reports whether it was truncated."),
});

export const GetRosterSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID to get roster for."),
  includeStudents: z.boolean().default(false)
    .describe("Include students in results. Default is instructors and TAs only."),
  searchTerm: z.string().max(200).optional()
    .describe("Optional search term to filter by name."),
  limit: z.coerce.number().int().positive().max(1000).default(100)
    .describe("Maximum users to return. Default 100. The response reports the true total and whether it was truncated."),
});

export const GetGradeOutlookSchema = z.object({
  courseId: z.coerce.number().int().positive()
    .describe("Course ID to analyze."),
  targetPercent: z.coerce.number().min(0).max(100).optional()
    .describe("The final grade the user wants, as a percentage (for example 80). Omit to just get the current standing and best/worst case."),
  totalWeight: z.coerce.number().positive().max(1000).default(100)
    .describe("Total weight of the course. Almost always 100."),
});

export const ExportDueDatesCalendarSchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(120).default(30).describe("How many days ahead to include"),
  courseId: z.coerce.number().int().positive().optional().describe("Only include this course"),
  includeSubmitted: z.boolean().default(false)
    .describe("Also include work that is already submitted or graded. Default is only work still left to do."),
  downloadPath: z.string().min(1).optional()
    .describe("Absolute path to a directory. When given, the .ics file is saved there instead of returned as text."),
});
