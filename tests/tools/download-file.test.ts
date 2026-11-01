import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerDownloadFile } from "../../src/tools/download-file.js";

function setup(response?: Response) {
  const apiClient = {
    le: (orgUnitId: number, p: string) => `/d2l/api/le/1.0/${orgUnitId}${p}`,
    get: vi.fn(async () => []),
    getRaw: vi.fn(async () => response ?? new Response("hello", { status: 200 })),
  };

  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };

  registerDownloadFile(server as any, apiClient as any);
  return { call: (args: unknown) => handler!(args), apiClient };
}

const text = (result: any) => result.content[0].text as string;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bs-download-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("download_file validation", () => {
  it("asks for topicId or folderId with fileId when none is given", async () => {
    const { call, apiClient } = setup();
    const result = await call({ courseId: 1, downloadPath: dir });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Either topicId");
    expect(apiClient.getRaw).not.toHaveBeenCalled();
  });

  it("rejects folderId without fileId", async () => {
    const { call, apiClient } = setup();
    const result = await call({ courseId: 1, folderId: 5, downloadPath: dir });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Either topicId");
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it.each([0, -3, 1.5])("rejects topicId %s", async (topicId) => {
    const { call, apiClient } = setup();
    const result = await call({ courseId: 1, topicId, downloadPath: dir });
    expect(result.isError).toBe(true);
    expect(apiClient.getRaw).not.toHaveBeenCalled();
  });

  it.each([
    [0, 2],
    [2, -1],
  ])("rejects submission ids folderId=%s fileId=%s", async (folderId, fileId) => {
    const { call, apiClient } = setup();
    const result = await call({ courseId: 1, folderId, fileId, downloadPath: dir });
    expect(result.isError).toBe(true);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("rejects a relative download path", async () => {
    const { call } = setup();
    const result = await call({ courseId: 1, topicId: 2, downloadPath: "relative/dir" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("absolute path");
  });

  it("rejects a download directory that does not exist", async () => {
    const { call } = setup();
    const result = await call({ courseId: 1, topicId: 2, downloadPath: path.join(dir, "missing") });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("does not exist");
  });

  it("rejects a download path that is a file", async () => {
    const file = path.join(dir, "a.txt");
    await fs.writeFile(file, "x");
    const { call } = setup();
    const result = await call({ courseId: 1, topicId: 2, downloadPath: file });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not a directory");
  });
});

describe("download_file error messages", () => {
  it("explains an undetectable type, as when Brightspace returns binary junk", async () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00]);
    const { call } = setup(new Response(junk));
    const result = await call({ courseId: 1, topicId: 2, downloadPath: dir, customFilename: "a.bin" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Could not save the file\./);
    expect(text(result)).toContain("could not be identified");
    expect(text(result)).toContain("error page");
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("explains a type that is not allowed and shows the detected type", async () => {
    const gz = Buffer.from("1f8b0800000000000003", "hex");
    const { call } = setup(new Response(gz));
    const result = await call({ courseId: 1, topicId: 2, downloadPath: dir, customFilename: "a.gz" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("(detected type: application/gzip)");
    expect(text(result)).toContain("allowed download list");
  });

  it("explains a bad filename and points to customFilename", async () => {
    const { call } = setup(new Response("plain text"));
    const result = await call({ courseId: 1, topicId: 2, downloadPath: dir, customFilename: ".." });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("customFilename");
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("saves a valid file into the chosen directory", async () => {
    const { call, apiClient } = setup(new Response("plain notes"));
    const result = await call({ courseId: 1, topicId: 2, downloadPath: dir, customFilename: "notes.txt" });
    expect(result.isError).toBeFalsy();
    expect(apiClient.getRaw).toHaveBeenCalledWith("/d2l/api/le/1.0/1/content/topics/2/file");
    expect(await fs.readFile(path.join(dir, "notes.txt"), "utf8")).toBe("plain notes");
  });
});
