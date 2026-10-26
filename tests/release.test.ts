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

  it("lists exactly the 17 registered tools in README.md", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const toolsSection = readme.slice(readme.indexOf("## Tools"), readme.indexOf("### Built-in prompts"));
    const toolNames = [...toolsSection.matchAll(/\| `(\w+)` \|/g)].map((m) => m[1]);
    const expected = [
      "get_todo",
      "get_upcoming_due_dates",
      "get_my_courses",
      "get_my_grades",
      "get_assignments",
      "get_assignment_files",
      "get_course_content",
      "get_syllabus",
      "get_announcements",
      "get_discussions",
      "get_roster",
      "get_classlist_emails",
      "download_file",
      "get_grade_outlook",
      "export_due_dates_calendar",
      "get_calendar_events",
      "get_whats_new",
    ];
    expect(new Set(toolNames)).toEqual(new Set(expected));
  });

  it("lists exactly the 9 registered prompts in README.md", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const promptsLine = readme.split("\n").find((line) => line.startsWith("`what_should_i_do_now`")) ?? "";
    const promptNames = [...promptsLine.matchAll(/`(\w+)`/g)].map((m) => m[1]);
    const expected = [
      "what_should_i_do_now",
      "plan_my_week",
      "weekly_digest",
      "grade_target",
      "exam_prep",
      "summarize_assignment",
      "put_deadlines_in_my_calendar",
      "catch_me_up",
      "when_are_my_exams",
    ];
    expect(new Set(promptNames)).toEqual(new Set(expected));
  });
});
