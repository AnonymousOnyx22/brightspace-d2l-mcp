import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({ log: vi.fn(), enableStdoutGuard: vi.fn() }));

let home: string;
let url: string;
let close: () => Promise<void>;

const rpc = (target: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bsm-http-"));
  process.env.BRIGHTSPACE_MCP_HOME = home;
  delete process.env.D2L_BASE_URL;
  const { startHttpServer } = await import("../../src/server.js");
  ({ url, close } = await startHttpServer({ port: 0, host: "127.0.0.1", noAuth: false }));
});

afterAll(async () => {
  await close();
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.BRIGHTSPACE_MCP_HOME;
});

describe("streamable HTTP server", () => {
  it("rejects requests without the access token", async () => {
    const base = url.replace(/\/mcp\/.*$/, "/mcp");
    const response = await rpc(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
  });

  it("lists tools with the token in the URL", async () => {
    const response = await rpc(url, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("get_todo");
  });

  it("accepts the token as a Bearer header and explains when setup hasn't run", async () => {
    const token = url.split("/").pop()!;
    const base = url.replace(/\/mcp\/.*$/, "/mcp");
    const response = await rpc(base, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_todo", arguments: {} } }, { authorization: `Bearer ${token}` });
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("not set up");
  });

  it("refuses --no-auth on a public interface", async () => {
    const { startHttpServer } = await import("../../src/server.js");
    await expect(startHttpServer({ port: 0, host: "0.0.0.0", noAuth: true })).rejects.toThrow(/localhost/);
  });
});
