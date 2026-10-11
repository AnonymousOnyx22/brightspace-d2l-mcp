import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("read-only guarantee", () => {
  it("only ever sends GET requests to Brightspace APIs", () => {
    const client = fs.readFileSync(path.join(root, "api", "client.ts"), "utf8");
    expect(client).not.toMatch(/method:\s*"(POST|PUT|DELETE|PATCH)"/);
    expect(client).not.toMatch(/\b(post|put|write)</);
  });

  it("has no tool that writes to Brightspace", () => {
    const tools = sourceFiles(path.join(root, "tools")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect(tools).not.toMatch(/\.(post|put|write)</);
    expect(tools).not.toMatch(/method:\s*"(POST|PUT|DELETE|PATCH)"/);
  });

  it("marks every get_ tool as read only", () => {
    for (const file of sourceFiles(path.join(root, "tools"))) {
      const text = fs.readFileSync(file, "utf8");
      if (!/registerTool\(\s*"get_/.test(text)) continue;
      expect(text, path.basename(file)).toMatch(/readOnlyHint:\s*true/);
    }
  });
});
