import { describe, it, expect, vi } from "vitest";
import { registerGetMyGrades } from "../../src/tools/get-my-grades.js";
import type { AppConfig } from "../../src/types/index.js";

const COURSE_A = { Id: 101, Name: "CS 180", Code: "cs180" };
const COURSE_B = { Id: 202, Name: "MA 261", Code: "ma261" };

function makeConfig(): AppConfig {
  return {
    baseUrl: "https://brightspace.example.edu",
    sessionDir: "/tmp/nope",
    tokenTtl: 3600,
    headless: true,
    courseFilter: { activeOnly: true },
  } as AppConfig;
}

const enrollments = (...courses: Array<typeof COURSE_A>) => ({
  Items: courses.map((course) => ({
    OrgUnit: course,
    Access: { ClasslistRoleName: "Student", IsActive: true, LastAccessed: null },
  })),
});

function setup(respond: (path: string) => unknown, config: AppConfig = makeConfig()) {
  const requested: string[] = [];
  const apiClient = {
    lp: (p: string) => `/d2l/api/lp/1.0${p}`,
    le: (orgUnitId: number, p: string) => `/d2l/api/le/1.0/${orgUnitId}${p}`,
    get: vi.fn(async (path: string) => {
      requested.push(path);
      return respond(path);
    }),
  };

  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };

  registerGetMyGrades(server as any, apiClient as any, config);
  return { call: (args: unknown) => handler!(args), requested };
}

const parse = (result: any): any => JSON.parse(result.content[0].text);

const GRADE = {
  GradeObjectIdentifier: "1",
  GradeObjectName: "Homework 1",
  DisplayedGrade: "18 / 20",
  PointsNumerator: 18,
  PointsDenominator: 20,
  WeightedNumerator: null,
  WeightedDenominator: null,
  Comments: { Text: "Nice work", Html: "Nice work" },
  PrivateComments: null,
  LastModified: "2026-09-01T12:00:00.000Z",
  ReleasedDate: null,
};

const respondWithGrades = (path: string) => {
  if (path.includes("/enrollments/")) return enrollments(COURSE_A, COURSE_B);
  return [GRADE];
};

describe("get_my_grades course name lookup", () => {
  it("resolves a course name and queries only that course", async () => {
    const { call, requested } = setup(respondWithGrades);

    const data = parse(await call({ course: "MA 261" }));

    expect(data.courseId).toBe(COURSE_B.Id);
    expect(data.grades).toHaveLength(1);
    expect(data.grades[0]).toMatchObject({ name: "Homework 1", displayGrade: "18 / 20" });
    expect(requested.some((p) => p.includes(`/${COURSE_A.Id}/grades/`))).toBe(false);
    expect(requested.some((p) => p.includes(`/${COURSE_B.Id}/grades/`))).toBe(true);
  });

  it("resolves a course code without a space", async () => {
    const { call } = setup(respondWithGrades);

    const data = parse(await call({ course: "CS180" }));

    expect(data.courseId).toBe(COURSE_A.Id);
  });

  it("names get_my_courses when the course does not match", async () => {
    const { call, requested } = setup(respondWithGrades);

    const result = await call({ course: "Chemistry" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Chemistry");
    expect(result.content[0].text).toContain("get_my_courses");
    expect(requested.some((p) => p.includes("/grades/"))).toBe(false);
  });

  it("keeps courseId working without an enrollment lookup", async () => {
    const { call, requested } = setup(respondWithGrades);

    const data = parse(await call({ courseId: COURSE_B.Id }));

    expect(data.courseId).toBe(COURSE_B.Id);
    expect(requested.some((p) => p.includes("/enrollments/"))).toBe(false);
  });

  it("rejects both courseId and course", async () => {
    const { call } = setup(respondWithGrades);

    const result = await call({ courseId: COURSE_A.Id, course: "MA 261" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("either courseId or course");
  });
});
