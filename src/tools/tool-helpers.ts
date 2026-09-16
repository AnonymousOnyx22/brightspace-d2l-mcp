import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { ApiError, RateLimitError, NetworkError } from "../api/index.js";
import { TokenRefreshError } from "../api/errors.js";
import { AuthRequiredError } from "../auth/authenticator.js";
import { log } from "../utils/logger.js";
import { LOGIN_COMMAND } from "../utils/paths.js";
import {
  DownloadError,
  isSafeDetail,
  type DownloadFailureKind,
} from "../utils/download-errors.js";

export function toolResponse(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResponse(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const DOWNLOAD_FAILURE_GUIDANCE: Record<DownloadFailureKind, string> = {
  unsupportedType:
    "The file's format is not on the allowed download list. " +
    "Open it from Brightspace in a browser instead.",
  undetectableType:
    "The file's format could not be identified, so it was not saved. " +
    "This usually means Brightspace returned an error page instead of the file.",
  badFilename:
    "The name Brightspace gave this file cannot be used on disk. " +
    "Pass customFilename to choose one yourself.",
  pathTraversal:
    "The name Brightspace gave this file pointed outside the download " +
    "directory and was refused. Pass customFilename to choose one yourself.",
};

export function sanitizeError(error: unknown): CallToolResult {
  log("ERROR", "Tool error", error);

  if (error instanceof AuthRequiredError) {
    // Messages are written by this package (authenticator.ts), never copied from a remote response.
    return errorResponse(error.message);
  }

  // Checked before NetworkError, which it extends.
  if (error instanceof TokenRefreshError) {
    return errorResponse(
      "Brightspace could not renew your session right now. Your saved login was kept. " +
      "Try again in a few minutes."
    );
  }

  if (error instanceof DownloadError) {
    const detail = error.detail && isSafeDetail(error.detail) ? ` (detected type: ${error.detail})` : "";
    return errorResponse(`Could not save the file.${detail} ${DOWNLOAD_FAILURE_GUIDANCE[error.kind]}`);
  }

  if (error instanceof ApiError) {
    if (error.status === 404) {
      return errorResponse("Resource not found. The course or item may not exist, or you may not have access.");
    }
    if (error.status === 401) {
      return errorResponse(
        `Your Brightspace session expired and signing in again did not finish. Run \`${LOGIN_COMMAND}\` in a terminal, then try again.`
      );
    }
    if (error.status === 403) {
      return errorResponse("Access denied. You may not have permission to access this resource.");
    }
  }

  if (error instanceof RateLimitError) {
    return errorResponse("Rate limited by Brightspace. Please wait a moment and try again.");
  }

  if (error instanceof NetworkError) {
    return errorResponse("Could not connect to Brightspace. Check your internet connection.");
  }

  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return errorResponse(`Invalid input: ${issues.join(", ")}`);
  }

  return errorResponse("An unexpected error occurred. Please try again.");
}
