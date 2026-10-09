import { describe, expect, it } from "vitest";
import { computeGradeOutlook, type GradeLike } from "../../src/utils/grade-math.js";

const weighted = (name: string, earned: number, weight: number): GradeLike => ({
  name,
  pointsNumerator: earned,
  pointsDenominator: weight,
  weightedNumerator: earned,
  weightedDenominator: weight,
});

describe("computeGradeOutlook", () => {
  const grades = [weighted("Labs", 18, 20), weighted("Midterm", 24, 30), { ...weighted("Final Calculated Grade", 42, 50) }];

  it("ignores Brightspace rollup rows so nothing is counted twice", () => {
    const outlook = computeGradeOutlook(grades);
    expect(outlook.gradedItems).toBe(2);
    expect(outlook.gradedWeight).toBe(50);
    expect(outlook.currentPercent).toBe(84);
  });

  it("reports best and worst case over the whole course", () => {
    const outlook = computeGradeOutlook(grades);
    expect(outlook.remainingWeight).toBe(50);
    expect(outlook.worstCasePercent).toBe(42);
    expect(outlook.bestCasePercent).toBe(92);
  });

  it("works out what is needed on the remaining work", () => {
    const outlook = computeGradeOutlook(grades, { targetPercent: 80 });
    // needs 80 of 100 weighted points, has 42, so 38 of the remaining 50
    expect(outlook.target).toEqual({ targetPercent: 80, status: "achievable", neededOnRemainingPercent: 76 });
  });

  it("says when a target is out of reach", () => {
    expect(computeGradeOutlook(grades, { targetPercent: 95 }).target?.status).toBe("impossible");
  });

  it("says when a target is already secured", () => {
    expect(computeGradeOutlook(grades, { targetPercent: 40 }).target).toMatchObject({ status: "already_secured", neededOnRemainingPercent: null });
  });

  it("marks a target missed when nothing is left to earn", () => {
    const done = [weighted("All", 70, 100)];
    expect(computeGradeOutlook(done, { targetPercent: 80 }).target?.status).toBe("missed");
  });

  it("falls back to points when the course has no weights", () => {
    const outlook = computeGradeOutlook([
      { name: "A1", pointsNumerator: 8, pointsDenominator: 10, weightedNumerator: null, weightedDenominator: null },
      { name: "A2", pointsNumerator: 6, pointsDenominator: 10, weightedNumerator: null, weightedDenominator: null },
    ]);
    expect(outlook.mode).toBe("points");
    expect(outlook.currentPercent).toBe(70);
    expect(outlook.bestCasePercent).toBeNull();
  });

  it("handles a course with nothing graded", () => {
    const outlook = computeGradeOutlook([{ name: "A1", pointsNumerator: null, pointsDenominator: 10, weightedNumerator: null, weightedDenominator: null }]);
    expect(outlook.mode).toBe("none");
    expect(outlook.currentPercent).toBeNull();
  });
});
