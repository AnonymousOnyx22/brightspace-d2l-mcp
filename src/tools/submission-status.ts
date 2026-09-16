import { D2LApiClient, DEFAULT_CACHE_TTLS } from "../api/index.js";
import { log } from "../utils/logger.js";

export type SubmissionStatus =
  | "submitted"
  | "graded"
  | "draft"
  | "not_submitted"
  | "not_open_yet"
  | "closed"
  | "past_due"
  | "restricted"
  | "unknown";

export interface SubmissionFile {
  name: string;
  size: number;
  fileId: number;
}

export interface SubmissionSummary {
  submitted: boolean | null;
  submissionStatus: SubmissionStatus;
  statusNote?: string;
  submission: {
    submittedDate: string | null;
    attemptCount: number;
    files: SubmissionFile[];
    comment: string | null;
  } | null;
}

export interface FolderDates {
  Id: number;
  DueDate: string | null;
  Availability?: { StartDate: string | null; EndDate: string | null } | null;
}

interface RawSubmission {
  SubmissionDate?: string;
  Comment?: { Text?: string } | null;
  Files?: Array<{ FileId: number; FileName: string; Size: number }>;
}

interface EntityDropbox {
  Status?: number;
  Submissions?: RawSubmission[];
}

const STATUS_NAMES: Record<number, SubmissionStatus> = {
  0: "not_submitted",
  1: "submitted",
  2: "draft",
  3: "graded",
};

export function summarizeSubmission(raw: unknown): SubmissionSummary {
  const entries = (Array.isArray(raw) ? raw : (raw as { Objects?: unknown[] })?.Objects ?? []) as Array<EntityDropbox & RawSubmission>;
  const entity = entries[0];
  // Tolerate a flat submission list as well as the documented EntityDropbox shape.
  const subs: RawSubmission[] = entity?.Submissions ?? entries.filter((e) => e?.SubmissionDate);
  const latest = subs.reduce<RawSubmission | null>(
    (best, s) => (!best || new Date(s.SubmissionDate ?? 0) > new Date(best.SubmissionDate ?? 0) ? s : best),
    null,
  );
  const submitted = subs.length > 0 || entity?.Status === 1 || entity?.Status === 3;
  const status: SubmissionStatus = entity?.Status !== undefined && entity.Status in STATUS_NAMES
    ? STATUS_NAMES[entity.Status]
    : submitted ? "submitted" : "not_submitted";

  return {
    submitted: status === "draft" ? false : submitted,
    submissionStatus: status,
    submission: latest
      ? {
          submittedDate: latest.SubmissionDate ?? null,
          attemptCount: subs.length,
          files: latest.Files?.map((f) => ({ name: f.FileName, size: f.Size, fileId: f.FileId })) ?? [],
          comment: latest.Comment?.Text || null,
        }
      : null,
  };
}

export function restrictedStatus(folder: FolderDates, now = Date.now()): SubmissionSummary {
  const time = (d: string | null | undefined) => (d ? new Date(d).getTime() : NaN);
  const start = time(folder.Availability?.StartDate);
  const end = time(folder.Availability?.EndDate);
  const due = time(folder.DueDate);

  let submissionStatus: SubmissionStatus = "restricted";
  let statusNote = "Brightspace does not allow viewing this submission (release conditions or special access).";
  if (start > now) {
    submissionStatus = "not_open_yet";
    statusNote = `Not assigned yet: opens ${folder.Availability!.StartDate}.`;
  } else if (end < now) {
    submissionStatus = "closed";
    statusNote = `Closed on ${folder.Availability!.EndDate}.`;
  } else if (due < now) {
    submissionStatus = "past_due";
    statusNote = `Past the due date (${folder.DueDate}).`;
  }
  return { submitted: null, submissionStatus, statusNote, submission: null };
}

export async function fetchSubmissionStatus(
  apiClient: D2LApiClient,
  courseId: number,
  folder: FolderDates,
): Promise<SubmissionSummary> {
  try {
    const raw = await apiClient.get<unknown>(
      apiClient.le(courseId, `/dropbox/folders/${folder.Id}/submissions/mysubmissions/`),
      { ttl: DEFAULT_CACHE_TTLS.assignments },
    );
    return summarizeSubmission(raw);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return summarizeSubmission([]);
    if (status === 403) return restrictedStatus(folder);
    // Session and network failures are not "unknown status": let the tool report them.
    if (status === 401 || status === undefined) throw error;
    log("DEBUG", `Failed to fetch submissions for folder ${folder.Id}`, error);
    return { submitted: null, submissionStatus: "unknown", submission: null };
  }
}
