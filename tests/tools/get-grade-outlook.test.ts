import { describe, it, expect, vi } from "vitest";
import { registerGetGradeOutlook } from "../../src/tools/get-grade-outlook.js";
import { ApiError } from "../../src/api/index.js";

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

  describe("with a weighted fixture (42 earned on 50 graded weight)", () => {
    const fixture = () => [
      item("Labs", 18, 20, 18, 20),
      item("Midterm", 24, 30, 24, 30),
      item("Final Calculated Grade", 42, 50, 42, 50),
    ];

    it("reports exact best and worst case and the average needed on the rest", async () => {
      const outlook = parse(await setup(fixture())({ courseId: 101, targetPercent: 80 }));
      expect(outlook).toMatchObject({
        gradedItems: 2,
        currentPercent: 84,
        earnedWeight: 42,
        gradedWeight: 50,
        remainingWeight: 50,
        worstCasePercent: 42,
        bestCasePercent: 92,
        target: { targetPercent: 80, status: "achievable", neededOnRemainingPercent: 76 },
      });
    });

    it("flags a target that cannot be reached", async () => {
      const outlook = parse(await setup(fixture())({ courseId: 101, targetPercent: 95 }));
      expect(outlook.target).toEqual({ targetPercent: 95, status: "impossible", neededOnRemainingPercent: 106 });
    });

    it("flags a target that is already secured", async () => {
      const outlook = parse(await setup(fixture())({ courseId: 101, targetPercent: 40 }));
      expect(outlook.target).toEqual({ targetPercent: 40, status: "already_secured", neededOnRemainingPercent: null });
    });

    it("leaves target out when none is asked for", async () => {
      const outlook = parse(await setup(fixture())({ courseId: 101 }));
      expect(outlook.target).toBeUndefined();
    });

    it("reports a missed target when the whole course is graded", async () => {
      const call = setup([item("Everything", 70, 100, 70, 100)]);
      const outlook = parse(await call({ courseId: 101, targetPercent: 80 }));
      expect(outlook.remainingWeight).toBe(0);
      expect(outlook.target).toEqual({ targetPercent: 80, status: "missed", neededOnRemainingPercent: null });
    });

    it("uses totalWeight when the course is not out of 100", async () => {
      const call = setup([item("Labs", 18, 20, 18, 20)]);
      const outlook = parse(await call({ courseId: 101, totalWeight: 50, targetPercent: 90 }));
      expect(outlook.remainingWeight).toBe(30);
      expect(outlook.worstCasePercent).toBe(36);
      expect(outlook.bestCasePercent).toBe(96);
      expect(outlook.target.neededOnRemainingPercent).toBe(90);
    });
  });

  it("gives no weights or target for a course graded only in points", async () => {
    const outlook = parse(await setup([item("Lab 1", 17, 20, null, null)])({ courseId: 101, targetPercent: 80 }));
    expect(outlook.mode).toBe("points");
    expect(outlook.remainingWeight).toBeNull();
    expect(outlook.target).toBeUndefined();
  });

  it("asks for the grade values of the requested course", async () => {
    const get = vi.fn(async (_path: string) => [item("Lab 1", 17, 20, null, null)]);
    let handler: (args: unknown) => Promise<any>;
    const server = { registerTool: (_n: string, _m: unknown, fn: (args: unknown) => Promise<any>) => (handler = fn) };
    const apiClient = { le: (id: number, path: string) => `/d2l/api/le/1.0/${id}${path}`, get };
    registerGetGradeOutlook(server as any, apiClient as any);
    await handler!({ courseId: "202" });
    expect(get.mock.calls[0][0]).toBe("/d2l/api/le/1.0/202/grades/values/myGradeValues/");
  });

  it("returns an error for a target above 100", async () => {
    const result = await setup([item("Lab 1", 17, 20, null, null)])({ courseId: 101, targetPercent: 150 });
    expect(result.isError).toBe(true);
  });

  it("returns an error when Brightspace fails", async () => {
    let handler: (args: unknown) => Promise<any>;
    const server = { registerTool: (_n: string, _m: unknown, fn: (args: unknown) => Promise<any>) => (handler = fn) };
    const apiClient = {
      le: (id: number, path: string) => `/d2l/api/le/1.0/${id}${path}`,
      get: async () => {
        throw new ApiError(403, "/grades", "forbidden");
      },
    };
    registerGetGradeOutlook(server as any, apiClient as any);
    const result = await handler!({ courseId: 101 });
    expect(result.isError).toBe(true);
  });
});
