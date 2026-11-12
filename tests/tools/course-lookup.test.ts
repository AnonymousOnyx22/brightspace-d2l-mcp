import { describe, it, expect, vi } from "vitest";
import { registerGetAnnouncements } from "../../src/tools/get-announcements.js";
import { registerGetAssignments } from "../../src/tools/get-assignments.js";
import type { AppConfig } from "../../src/types/index.js";

const COURSE_A = { Id: 101, Name: "CS 180", Code: "cs180" };
const COURSE_B = { Id: 202, Name: "MA 261", Code: "ma261" };

const config = {
  baseUrl: "https://brightspace.example.edu",
  sessionDir: "/tmp/nope",
  tokenTtl: 3600,
  headless: true,
  courseFilter: { activeOnly: true },
} as AppConfig;

function setup(register: (s: any, a: any, c: AppConfig) => void) {
  const requested: string[] = [];
  const apiClient = {
    lp: (p: string) => `/d2l/api/lp/1.0${p}`,
    le: (id: number, p: string) => `/d2l/api/le/1.0/${id}${p}`,
    get: vi.fn(async (path: string) => {
      requested.push(path);
      if (path.includes("/enrollments/")) {
        return {
          Items: [COURSE_A, COURSE_B].map((c) => ({
            OrgUnit: c,
            Access: { ClasslistRoleName: "Student", IsActive: true, LastAccessed: null },
          })),
        };
      }
      return [];
    }),
  };
  let handler: (args: unknown) => Promise<any>;
  register({ registerTool: (_n: string, _m: unknown, fn: any) => (handler = fn) }, apiClient, config);
  return { call: (args: unknown) => handler!(args), requested };
}

describe.each([
  ["get_announcements", registerGetAnnouncements, "/news/"],
  ["get_assignments", registerGetAssignments, "/dropbox/folders/"],
])("%s course name lookup", (_name, register, marker) => {
  it("resolves a course name and queries only that course", async () => {
    const { call, requested } = setup(register as any);
    await call({ course: "MA 261" });
    expect(requested.some((p) => p.includes(`/${COURSE_B.Id}${marker}`))).toBe(true);
    expect(requested.some((p) => p.includes(`/${COURSE_A.Id}${marker}`))).toBe(false);
  });

  it("names get_my_courses when the course does not match", async () => {
    const { call } = setup(register as any);
    const result = await call({ course: "Chemistry" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("get_my_courses");
  });

  it("rejects both courseId and course", async () => {
    const { call } = setup(register as any);
    const result = await call({ courseId: 101, course: "MA 261" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("either courseId or course");
  });
});
