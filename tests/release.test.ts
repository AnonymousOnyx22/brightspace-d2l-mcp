import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

// The publish workflow refuses a release whose versions disagree, so catch it before tagging.
describe("release metadata", () => {
  it("keeps server.json in step with package.json", () => {
    const pkg = read("package.json");
    const server = read("server.json");
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(server.name).toBe(pkg.mcpName);
  });

  it("has a changelog entry for the current version", () => {
    const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## ${read("package.json").version}`);
  });
});
