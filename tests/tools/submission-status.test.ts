import { describe, expect, it, vi } from "vitest";
import { restrictedStatus, summarizeSubmission, fetchSubmissionStatus } from "../../src/tools/submission-status.js";
import { ApiError } from "../../src/api/errors.js";

vi.mock("../../src/utils/logger.js", () => ({ log: vi.fn() }));

describe("summarizeSubmission", () => {
  it("reads submissions nested inside the EntityDropbox shape", () => {
    const result = summarizeSubmission([
      {
        Entity: { DisplayName: "Student" },
        Status: 1,
        Submissions: [
          { SubmissionDate: "2026-09-10T00:00:00Z", Files: [{ FileId: 1, FileName: "old.pdf", Size: 1 }] },
          { SubmissionDate: "2026-09-15T00:00:00Z", Files: [{ FileId: 2, FileName: "new.pdf", Size: 2 }], Comment: { Text: "done" } },
        ],
      },
    ]);
    expect(result.submitted).toBe(true);
    expect(result.submissionStatus).toBe("submitted");
    expect(result.submission).toEqual({
      submittedDate: "2026-09-15T00:00:00Z",
      attemptCount: 2,
      files: [{ name: "new.pdf", size: 2, fileId: 2 }],
      comment: "done",
    });
  });

  it("reports unsubmitted, draft and graded statuses", () => {
    expect(summarizeSubmission([{ Status: 0, Submissions: [] }])).toMatchObject({ submitted: false, submissionStatus: "not_submitted" });
    expect(summarizeSubmission([{ Status: 2, Submissions: [] }])).toMatchObject({ submitted: false, submissionStatus: "draft" });
    expect(summarizeSubmission([{ Status: 3, Submissions: [{ SubmissionDate: "2026-09-01T00:00:00Z" }] }]))
      .toMatchObject({ submitted: true, submissionStatus: "graded" });
  });

  it("treats an empty response as not submitted", () => {
    expect(summarizeSubmission([])).toMatchObject({ submitted: false, submissionStatus: "not_submitted", submission: null });
  });
});

describe("restrictedStatus", () => {
  const now = Date.parse("2026-09-16T18:00:00Z");

  it("explains a dropbox that has not opened yet", () => {
    const result = restrictedStatus({ Id: 1, DueDate: "2026-09-20T00:00:00Z", Availability: { StartDate: "2026-09-16T21:00:00Z", EndDate: null } }, now);
    expect(result.submissionStatus).toBe("not_open_yet");
    expect(result.statusNote).toContain("2026-09-16T21:00:00Z");
  });

  it("explains a closed or past-due dropbox", () => {
    expect(restrictedStatus({ Id: 1, DueDate: "2026-09-09T00:00:00Z", Availability: { StartDate: null, EndDate: "2026-09-10T00:00:00Z" } }, now).submissionStatus).toBe("closed");
    expect(restrictedStatus({ Id: 1, DueDate: "2026-09-15T00:00:00Z", Availability: null }, now).submissionStatus).toBe("past_due");
  });

  it("falls back to restricted when the dates don't explain it", () => {
    expect(restrictedStatus({ Id: 1, DueDate: "2026-09-20T00:00:00Z" }, now).submissionStatus).toBe("restricted");
  });
});

describe("fetchSubmissionStatus", () => {
  const client = (error: unknown) => ({
    le: (_: number, p: string) => p,
    get: vi.fn(async () => { throw error; }),
  }) as never;

  it("maps 404 to not submitted and 403 to a date-based explanation", async () => {
    const folder = { Id: 5, DueDate: "2999-01-01T00:00:00Z", Availability: { StartDate: "2998-01-01T00:00:00Z", EndDate: null } };
    await expect(fetchSubmissionStatus(client(new ApiError(404, "/x", "")), 1, folder)).resolves.toMatchObject({ submissionStatus: "not_submitted" });
    await expect(fetchSubmissionStatus(client(new ApiError(403, "/x", "")), 1, folder)).resolves.toMatchObject({ submissionStatus: "not_open_yet" });
  });

  it("lets session failures reach the tool instead of hiding them", async () => {
    await expect(fetchSubmissionStatus(client(new ApiError(401, "/x", "")), 1, { Id: 5, DueDate: null })).rejects.toBeInstanceOf(ApiError);
  });
});
