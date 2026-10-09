export interface GradeLike {
  name: string;
  pointsNumerator: number | null;
  pointsDenominator: number | null;
  weightedNumerator: number | null;
  weightedDenominator: number | null;
}

export interface GradeOutlookOptions {
  /** The grade the student wants, as a percentage of the whole course. */
  targetPercent?: number;
  /** Total weight of the course. Brightspace courses are almost always out of 100. */
  totalWeight?: number;
}

export type TargetStatus = "already_secured" | "achievable" | "impossible" | "missed";

export interface GradeOutlook {
  mode: "weighted" | "points" | "none";
  gradedItems: number;
  /** Percentage on the work graded so far. */
  currentPercent: number | null;
  /** Weighted points earned and the weight those items cover. Weighted mode only. */
  earnedWeight: number | null;
  gradedWeight: number | null;
  remainingWeight: number | null;
  /** Final grade if everything left scores 0 or 100. Weighted mode only. */
  worstCasePercent: number | null;
  bestCasePercent: number | null;
  target?: {
    targetPercent: number;
    status: TargetStatus;
    /** Average percentage needed across all remaining work. */
    neededOnRemainingPercent: number | null;
  };
  note: string;
}

// Rollup rows Brightspace adds to the gradebook. Counting them would double count every other item.
const AGGREGATE = /^(final (calculated|adjusted) grade|calculated final grade|current grade|course total|total)$/i;

const round = (value: number) => Math.round(value * 100) / 100;

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function computeGradeOutlook(grades: GradeLike[], options: GradeOutlookOptions = {}): GradeOutlook {
  const totalWeight = options.totalWeight ?? 100;
  const items = grades.filter((grade) => !AGGREGATE.test(grade.name.trim()));

  const weighted = items.filter(
    (grade) =>
      grade.weightedNumerator !== null &&
      grade.weightedDenominator !== null &&
      Number.isFinite(grade.weightedNumerator) &&
      Number.isFinite(grade.weightedDenominator) &&
      grade.weightedDenominator > 0,
  );

  if (weighted.length > 0) {
    const earned = sum(weighted.map((grade) => grade.weightedNumerator as number));
    const gradedWeight = sum(weighted.map((grade) => grade.weightedDenominator as number));
    const remaining = Math.max(0, totalWeight - gradedWeight);
    const outlook: GradeOutlook = {
      mode: "weighted",
      gradedItems: weighted.length,
      currentPercent: round((earned / gradedWeight) * 100),
      earnedWeight: round(earned),
      gradedWeight: round(gradedWeight),
      remainingWeight: round(remaining),
      worstCasePercent: round((earned / totalWeight) * 100),
      bestCasePercent: round(((earned + remaining) / totalWeight) * 100),
      note:
        "Based on the weights Brightspace reports for graded items. Items the instructor has not graded yet " +
        "count as remaining work. If the course drops lowest scores or uses bonus marks, treat this as an estimate.",
    };

    if (options.targetPercent !== undefined) {
      const targetEarned = (options.targetPercent / 100) * totalWeight;
      let status: TargetStatus;
      let needed: number | null = null;
      if (earned >= targetEarned) {
        status = "already_secured";
      } else if (remaining <= 0) {
        status = "missed";
      } else {
        needed = ((targetEarned - earned) / remaining) * 100;
        status = needed > 100 ? "impossible" : "achievable";
      }
      outlook.target = {
        targetPercent: options.targetPercent,
        status,
        neededOnRemainingPercent: needed === null ? null : round(needed),
      };
    }
    return outlook;
  }

  const pointed = items.filter(
    (grade) =>
      grade.pointsNumerator !== null &&
      grade.pointsDenominator !== null &&
      Number.isFinite(grade.pointsNumerator) &&
      Number.isFinite(grade.pointsDenominator) &&
      grade.pointsDenominator > 0,
  );

  if (pointed.length > 0) {
    const earned = sum(pointed.map((grade) => grade.pointsNumerator as number));
    const possible = sum(pointed.map((grade) => grade.pointsDenominator as number));
    return {
      mode: "points",
      gradedItems: pointed.length,
      currentPercent: round((earned / possible) * 100),
      earnedWeight: null,
      gradedWeight: null,
      remainingWeight: null,
      worstCasePercent: null,
      bestCasePercent: null,
      note:
        "This course does not report weights, so only the percentage on graded work is available. " +
        "Ask the user for the syllabus weights (or read get_syllabus) to work out what they need on the rest.",
    };
  }

  return {
    mode: "none",
    gradedItems: 0,
    currentPercent: null,
    earnedWeight: null,
    gradedWeight: null,
    remainingWeight: null,
    worstCasePercent: null,
    bestCasePercent: null,
    note: "Nothing has been graded in this course yet, so there is no grade to work from.",
  };
}
