
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sanitizeFilename from "sanitize-filename";
import { DownloadError } from "./download-errors.js";

const CFB_MIME = "application/x-cfb";
const CFB_EXTENSION_MIMES: Record<string, string> = {
  ".doc": "application/msword",
  ".dot": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".xlt": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pot": "application/vnd.ms-powerpoint",
  ".pps": "application/vnd.ms-powerpoint",
};

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export const ALLOWED_MIME_TYPES: string[] = [
  // Documents
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Text
  "text/plain",
  "text/csv",
  "text/html",
  // Data
  "application/json",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  // Media
  "video/mp4",
  "audio/mpeg",
  "audio/wav",
];

export function validateDownloadPath(
  baseDir: string,
  filename: string
): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    decoded = filename;
  }

  // Sanitize filename (removes path separators, null bytes, etc.)
  const sanitized = sanitizeFilename(decoded);

  if (!sanitized || sanitized.length === 0) {
    throw new DownloadError("badFilename", "Invalid filename after sanitization");
  }

  // Resolve full path
  const fullPath = path.resolve(baseDir, sanitized);
  const resolvedBase = path.resolve(baseDir);

  // Verify resolved path is within base directory
  if (
    !fullPath.startsWith(resolvedBase + path.sep) &&
    fullPath !== resolvedBase
  ) {
    throw new DownloadError("pathTraversal", "Path traversal detected");
  }

  return fullPath;
}

export async function validateFileType(
  buffer: Buffer,
  allowedTypes: string[] = ALLOWED_MIME_TYPES,
  filename?: string
): Promise<{ mime: string; ext: string }> {
  // Try magic byte detection first
  const detected = await fileTypeFromBuffer(buffer);

  if (detected) {
    if (detected.mime === CFB_MIME) {
      const ext = filename ? path.extname(filename).toLowerCase() : "";
      const resolved = CFB_EXTENSION_MIMES[ext];
      if (resolved && allowedTypes.includes(resolved)) {
        return { mime: resolved, ext: ext.slice(1) };
      }
      throw new DownloadError(
        "unsupportedType",
        `Compound File Binary with extension '${ext || "none"}' is not an allowed Office format`,
        CFB_MIME
      );
    }
    if (!allowedTypes.includes(detected.mime)) {
      throw new DownloadError(
        "unsupportedType",
        `File type '${detected.mime}' not allowed`,
        detected.mime
      );
    }
    return { mime: detected.mime, ext: detected.ext };
  }

  // Fallback for text-based files with no magic-byte signature: accept if the
  // buffer decodes as UTF-8 (rejecting binaries and NUL bytes), then sniff HTML.
  if (!buffer.includes(0)) {
    let decoded: string | null = null;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      // Invalid UTF-8, so treat as binary.
    }

    if (decoded !== null) {
      const noBom =
        decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
      const head = noBom.trimStart().toLowerCase();
      const isHtml =
        head.startsWith("<!doctype html") || head.startsWith("<html");
      const mime = isHtml ? "text/html" : "text/plain";
      const ext = isHtml ? "html" : "txt";

      if (allowedTypes.includes(mime)) {
        return { mime, ext };
      }
    }
  }

  throw new DownloadError(
    "undetectableType",
    "Could not determine file type or type not allowed"
  );
}

export function validateContentId(id: unknown): number {
  if (typeof id !== "number") {
    throw new Error("Content ID must be a number");
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Content ID must be a positive integer");
  }
  return id;
}

export function validateBaseUrl(url: string, expectedBaseUrl: string): void {
  if (!url.startsWith(expectedBaseUrl)) {
    throw new Error(
      `URL must start with ${expectedBaseUrl}, got: ${url.substring(0, 50)}...`
    );
  }
}
