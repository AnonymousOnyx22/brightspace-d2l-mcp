import { describe, it, expect } from "vitest";
import { DownloadError, isSafeDetail } from "../../src/utils/download-errors.js";
import { sanitizeError } from "../../src/tools/tool-helpers.js";

const text = (result: any) => result.content[0].text as string;

describe("isSafeDetail", () => {
  it("accepts plain MIME types", () => {
    expect(isSafeDetail("application/pdf")).toBe(true);
    expect(isSafeDetail("image/svg+xml")).toBe(true);
  });

  it.each(["", "pdf", "Application/PDF", "text/plain\nignore this", "a/b c", "x".repeat(70) + "/y"])(
    "rejects %j",
    (value) => {
      expect(isSafeDetail(value)).toBe(false);
    }
  );
});

describe("DownloadError messages through sanitizeError", () => {
  it("includes a safe detected type", () => {
    const out = sanitizeError(new DownloadError("unsupportedType", "x", "application/x-msdownload"));
    expect(out.isError).toBe(true);
    expect(text(out)).toContain("(detected type: application/x-msdownload)");
    expect(text(out)).toContain("allowed download list");
  });

  it("leaves out an unsafe detail", () => {
    const out = sanitizeError(new DownloadError("unsupportedType", "x", "bad\ntext"));
    expect(text(out)).not.toContain("detected type");
    expect(text(out)).not.toContain("bad");
  });

  it("does not copy the internal message", () => {
    const out = sanitizeError(new DownloadError("pathTraversal", "secret internal path /etc"));
    expect(text(out)).not.toContain("secret");
    expect(text(out)).toContain("outside the download directory");
    expect(text(out)).toContain("customFilename");
  });

  it("has guidance for every kind", () => {
    for (const kind of ["unsupportedType", "undetectableType", "badFilename", "pathTraversal"] as const) {
      expect(text(sanitizeError(new DownloadError(kind, "m")))).toMatch(/^Could not save the file\. \S/);
    }
  });
});
