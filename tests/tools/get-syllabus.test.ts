import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import { registerGetSyllabus } from "../../src/tools/get-syllabus.js";
import { ApiError } from "../../src/api/index.js";

const COURSE_ID = 101;

type Overview = { Description: { Text: string; Html: string } | null };

interface Options {
  overview?: Overview | Error;
  attachment?: Response | Error;
}

/** Captures the registered handler and mocks the overview and attachment calls. */
function setup({ overview, attachment }: Options) {
  const apiClient = {
    le: (orgUnitId: number, p: string) => `/d2l/api/le/1.0/${orgUnitId}${p}`,
    get: vi.fn(async (_path: string) => {
      if (overview instanceof Error) throw overview;
      return overview;
    }),
    getRaw: vi.fn(async (_path: string) => {
      if (attachment instanceof Error) throw attachment;
      return attachment ?? new Response(null, { status: 404 });
    }),
  };

  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };

  registerGetSyllabus(server as any, apiClient as any);
  return { call: (args: unknown) => handler!(args), apiClient };
}

const parse = (result: any) => JSON.parse(result.content[0].text);

const withHtml = (html: string): Overview => ({ Description: { Text: "", Html: html } });

describe("get_syllabus", () => {
  it("returns the overview description as markdown", async () => {
    const { call, apiClient } = setup({
      overview: withHtml("<p>Grading is <strong>40% exam</strong>.</p>"),
      attachment: new Response(null, { status: 404 }),
    });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.courseId).toBe(COURSE_ID);
    expect(out.description.markdown).toContain("Grading is");
    expect(out.description.markdown).toContain("40% exam");
    expect(out.description.markdown).not.toContain("<p>");
    expect(out.hasAttachment).toBe(false);
    expect(apiClient.get.mock.calls[0][0]).toBe(`/d2l/api/le/1.0/${COURSE_ID}/overview`);
  });

  it("returns a null description when the overview has no HTML", async () => {
    const { call } = setup({ overview: { Description: null } });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.description).toBeNull();
    expect(out.hasAttachment).toBe(false);
  });

  it("answers with a message when the overview returns 404", async () => {
    const { call, apiClient } = setup({
      overview: new ApiError(404, "/overview", "not found"),
    });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.description).toBeNull();
    expect(out.hasAttachment).toBe(false);
    expect(out.message).toMatch(/No syllabus/);
    expect(apiClient.getRaw).not.toHaveBeenCalled();
  });

  it("reports an attachment that is not a PDF without extracting text", async () => {
    const { call } = setup({
      overview: withHtml("<p>See attached.</p>"),
      attachment: new Response("plain text", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="syllabus.txt"' },
      }),
    });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.hasAttachment).toBe(true);
    expect(out.syllabusText).toBeUndefined();
  });

  it("keeps the description when the attachment request fails", async () => {
    const { call } = setup({
      overview: withHtml("<p>Hello</p>"),
      attachment: new Error("network down"),
    });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.description.markdown).toContain("Hello");
    expect(out.hasAttachment).toBe(false);
  });

  it("rejects an attachment whose Content-Length is over the limit", async () => {
    const { call } = setup({
      overview: withHtml("<p>Big</p>"),
      attachment: new Response("x", {
        status: 200,
        headers: { "Content-Length": String(500 * 1024 * 1024) },
      }),
    });

    const result = await call({ courseId: COURSE_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/too large/);
  });

  it("rejects a relative downloadPath before any request", async () => {
    const { call, apiClient } = setup({ overview: withHtml("<p>x</p>") });

    const result = await call({ courseId: COURSE_ID, downloadPath: "relative/dir" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/absolute/);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("rejects a downloadPath that does not exist", async () => {
    const { call, apiClient } = setup({ overview: withHtml("<p>x</p>") });
    const missing = `${os.tmpdir()}/brightspace-mcp-missing-${Date.now()}`;

    const result = await call({ courseId: COURSE_ID, downloadPath: missing });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/does not exist/);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("says there is no attachment when downloadPath is given and none exists", async () => {
    const { call } = setup({
      overview: withHtml("<p>x</p>"),
      attachment: new Response(null, { status: 404 }),
    });

    const out = parse(await call({ courseId: COURSE_ID, downloadPath: os.tmpdir() }));
    expect(out.download.success).toBe(false);
    expect(out.download.error).toMatch(/No attachment/);
  });

  it("surfaces other API errors as an error response", async () => {
    const { call } = setup({
      overview: new ApiError(500, "/overview", "boom"),
    });

    const result = await call({ courseId: COURSE_ID });
    expect(result.isError).toBe(true);
  });
});
