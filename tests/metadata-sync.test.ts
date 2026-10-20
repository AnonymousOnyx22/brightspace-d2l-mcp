import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const readText = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file: string) => JSON.parse(readText(file));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const registeredNames = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].map((m) => m[1]);

const toolNames = sourceFiles(path.join(root, "src", "tools")).flatMap((file) =>
  registeredNames(/registerTool\(\s*"([^"]+)"/g, readText(path.relative(root, file))),
);
const promptNames = registeredNames(/registerPrompt\(\s*"([^"]+)"/g, readText("src/prompts.ts"));

// LLM directories like Glama and llms.txt consumers read these two files, so they must match the code.
describe("llms.txt and glama.json", () => {
  const glama = readJson("glama.json");
  const llms = readText("llms.txt");

  it("lists every registered tool", () => {
    expect(toolNames.length).toBeGreaterThan(0);
    expect([...glama.tools].sort()).toEqual([...toolNames].sort());
    for (const name of toolNames) expect(llms, name).toContain(name);
    expect(llms).toContain(`${toolNames.length} MCP tools`);
  });

  it("lists every registered prompt", () => {
    expect(promptNames.length).toBeGreaterThan(0);
    expect([...glama.prompts].sort()).toEqual([...promptNames].sort());
    for (const name of promptNames) expect(llms, name).toContain(name);
  });

  it("carries the current version", () => {
    expect(glama.version).toBe(readJson("package.json").version);
    expect(llms).toContain(readJson("package.json").version);
  });
});
