import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..", "src", "tools");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

// Pull the description block each registerTool call passes, from `description:` up to `inputSchema`.
function descriptionsIn(text: string): string[] {
  return [...text.matchAll(/registerTool\(\s*"([^"]+)",\s*\{[\s\S]*?description:([\s\S]*?)inputSchema/g)].map(
    (match) => `${match[1]}: ${match[2]}`
  );
}

describe("tool descriptions", () => {
  it("gives every registered tool an example prompt", () => {
    const seen: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = fs.readFileSync(file, "utf8");
      for (const description of descriptionsIn(text)) {
        seen.push(description.split(":")[0]);
        expect(description, path.basename(file)).toContain("Example:");
      }
    }
    expect(seen.length).toBeGreaterThan(0);
  });
});
