import { describe, it, expect } from "vitest";
import { registerGetGradeOutlook } from "../../src/tools/get-grade-outlook.js";

const item = (name: string, pn: number | null, pd: number | null, wn: number | null, wd: number | null) => ({
  GradeObjectName: name,
  PointsNumerator: pn,
  PointsDenominator: pd,
  WeightedNumerator: wn,
  WeightedDenominator: wd,
});

function setup(values: unknown[]) {
  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };
  const apiClient = { le: (courseId: number, path: string) => `/d2l/api/le/1.0/${courseId}${path}`, get: async () => values };
  registerGetGradeOutlook(server as any, apiClient as any);
  return (args: unknown) => handler!(args);
}

const parse = (result: any) => JSON.parse(result.content[0].text);

describe("get_grade_outlook", () => {
  it("gives the current percent and the target for a course with weighted grades", async () => {
    const call = setup([item("Quiz 1", 8, 10, 8, 10), item("Midterm", 36, 50, 21.6, 30)]);
    const result = await call({ courseId: 101, targetPercent: 80 });
    expect(result.isError).toBeFalsy();
    const outlook = parse(result);
    expect(outlook.mode).toBe("weighted");
    expect(outlook.courseId).toBe(101);
    expect(outlook.currentPercent).toBeCloseTo(74, 0);
    expect(outlook.target.targetPercent).toBe(80);
  });

  it("still answers for a course graded only in points, instead of an error", async () => {
    const call = setup([item("Lab 1", 17, 20, null, null), item("Lab 2", 18, 20, null, null)]);
    const result = await call({ courseId: 101 });
    expect(result.isError).toBeFalsy();
    const outlook = parse(result);
    expect(outlook.mode).toBe("points");
    expect(outlook.currentPercent).toBeCloseTo(87.5, 1);
  });

  it("explains what to do when nothing in the course has been graded", async () => {
    const call = setup([item("Final Calculated Grade", null, null, null, null)]);
    const result = await call({ courseId: 101, targetPercent: 80 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no graded items yet");
    expect(result.content[0].text).toContain("get_my_grades");
  });

  it("does not count the rollup rows Brightspace adds as graded work", async () => {
    const call = setup([item("Final Calculated Grade", 90, 100, 90, 100), item("Lab 1", 17, 20, null, null)]);
    const outlook = parse(await call({ courseId: 101 }));
    expect(outlook.gradedItems).toBe(1);
  });
});
