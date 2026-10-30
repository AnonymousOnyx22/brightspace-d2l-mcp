
import { AuthError } from "../utils/errors.js";
import { SETUP_COMMAND } from "../utils/paths.js";

// A dead Brightspace session must never reach the person as a bare 401. Every
// 401 message carries the command that signs them in again, so the text stays
// fixable wherever it shows up: a tool result mid-chat, a log line, or the CLI.
export const SESSION_EXPIRED_HINT =
  `Your Brightspace session expired. Run \`${SETUP_COMMAND}\` again to sign in, then retry.`;

// Appends the sign-in command to a 401. A caller that already named the command
// keeps its own wording, so the hint is never repeated in one message.
function withSessionHint(status: number, message: string): string {
  if (status !== 401 || message.includes(SETUP_COMMAND)) return message;
  const detail = message.trim();
  return detail ? `${detail} ${SESSION_EXPIRED_HINT}` : SESSION_EXPIRED_HINT;
}

// A stale course id must never reach the person as a bare 404. Every 404
// message names the tool that lists the valid ids, so the next step is obvious
// wherever the text shows up: a tool result mid-chat, a log line, or the CLI.
export const COURSE_NOT_FOUND_HINT =
  `Call \`get_my_courses\` to list valid course IDs, then retry.`;

// An empty enrollment list gives the caller nothing to work with, so the
// message points at the command that checks the sign in again.
export const NO_COURSES_HINT =
  `No courses came back from Brightspace. Run \`${SETUP_COMMAND}\` again to check your sign in, then retry.`;

// Appends the get_my_courses hint to a 404. A caller that already named the
// tool keeps its own wording, so the hint is never repeated in one message.
function withCourseHint(status: number, message: string): string {
  if (status !== 404 || message.includes("get_my_courses")) return message;
  const detail = message.trim();
  return detail ? `${detail} ${COURSE_NOT_FOUND_HINT}` : COURSE_NOT_FOUND_HINT;
}

// Base class for all HTTP API errors
export class ApiError extends AuthError {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    message: string,
    public readonly responseBody?: string,
    cause?: Error,
  ) {
    super(
      `[PBMCP-2001] API error (${status}) at ${endpoint}: ${withSessionHint(status, withCourseHint(status, message))}`,
      cause,
    );
    this.name = "ApiError";
  }
}

// Generic HTTP error (non-401/429) - semantic alias for ApiError
export class HttpError extends ApiError {
  constructor(
    status: number,
    endpoint: string,
    message: string,
    responseBody?: string,
    cause?: Error,
  ) {
    super(status, endpoint, message, responseBody, cause);
    this.name = "HttpError";
  }
}

// Rate limit error (429 Too Many Requests)
export class RateLimitError extends ApiError {
  constructor(
    endpoint: string,
    public readonly retryAfter?: number, // seconds
  ) {
    const message = retryAfter
      ? `[PBMCP-2002] Rate limited, retry after ${retryAfter}s`
      : "[PBMCP-2002] Rate limited";
    super(429, endpoint, message);
    this.name = "RateLimitError";
  }
}

// Network-level error (no HTTP status code)
// For fetch failures, timeouts, DNS errors
export class NetworkError extends AuthError {
  constructor(message: string, cause?: Error) {
    super(`[PBMCP-2003] Network error: ${message}`, cause);
    this.name = "NetworkError";
  }
}

export class TokenRefreshError extends NetworkError {
  constructor(detail: string, cause?: Error) {
    super(`Token refresh is temporarily unavailable: ${detail}. Your saved session was retained. Try again later.`, cause);
    this.name = "TokenRefreshError";
  }
}

// The caller named a course id that is not in their enrollments. Thrown from
// the enrollment check, before any course scoped request goes out, so the
// person sees this instead of a bare 404 from Brightspace.
export class CourseNotFoundError extends Error {
  constructor(public readonly courseId: number) {
    super(`Course ${courseId} is not one of your Brightspace courses. ${COURSE_NOT_FOUND_HINT}`);
    this.name = "CourseNotFoundError";
  }
}

// The enrollment list came back empty, so there is nothing for any course tool
// to read. Setting up again checks the saved sign in and the school address.
export class NoCoursesError extends Error {
  constructor() {
    super(`${NO_COURSES_HINT} ${COURSE_NOT_FOUND_HINT}`);
    this.name = "NoCoursesError";
  }
}
