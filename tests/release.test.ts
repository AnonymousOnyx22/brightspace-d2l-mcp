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

  it("sends the registry to the npm package of the same version", () => {
    const pkg = read("package.json");
    const server = read("server.json");
    expect(server.packages[0].registryType).toBe("npm");
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it("fits the MCP Registry's 100 character description limit", () => {
    expect(read("server.json").description.length).toBeLessThanOrEqual(100);
  });

  it("has a changelog entry for the current version", () => {
    const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## ${read("package.json").version}`);
  });

  it("builds and runs the tests before publishing", () => {
    const prepublish = read("package.json").scripts.prepublishOnly;
    expect(prepublish).toContain("npm run build");
    expect(prepublish).toContain("npm test");
  });
});
