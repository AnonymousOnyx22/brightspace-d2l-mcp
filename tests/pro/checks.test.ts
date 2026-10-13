import { describe, expect, it } from "vitest";
import { dailyDigest, deadlineAlerts, emptyState, gradeAlerts, pruneState } from "../../src/pro/checks.js";
import type { DueItem } from "../../src/tools/get-upcoming-due-dates.js";

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 14, 9, 0, 0).getTime(); // 9:00 local

function item(id: number, hoursAway: number, status: DueItem["submissionStatus"] = "not_submitted"): DueItem {
  return {
    type: "assignment", id, title: `Task ${id}`, courseId: 1, courseName: "COMP 101",
    dueDate: new Date(NOW + hoursAway * HOUR).toISOString(), startDate: null, endDate: null,
    url: `https://school.example/${id}`, submitted: status === "submitted", submissionStatus: status, submittedDate: null,
  };
}

describe("deadline alerts", () => {
  it("alerts once at 24 hours and once at 2 hours, only for unsubmitted work", () => {
    const state = emptyState();
    const items = [item(1, 20), item(2, 1), item(3, 20, "submitted"), item(4, 30), item(5, -1)];
    const first = deadlineAlerts(items, state, NOW);
    expect(first.map((n) => n.title)).toEqual(["Due in 24 hours: Task 1", "Due soon: Task 2"]);
    expect(deadlineAlerts(items, state, NOW + 60_000)).toEqual([]);

    const later = deadlineAlerts([item(1, 1.5 + 18.5)].map((i) => ({ ...i, dueDate: new Date(NOW + 20 * HOUR).toISOString() })), state, NOW + 18.5 * HOUR);
    expect(later.map((n) => n.title)).toEqual(["Due soon: Task 1"]);
  });

  it("does not send a 24 hour alert after the 2 hour one", () => {
    const state = emptyState();
    deadlineAlerts([item(7, 1)], state, NOW);
    expect(deadlineAlerts([item(7, 1)], state, NOW + 1000)).toEqual([]);
  });
});

describe("daily digest", () => {
  it("sends once per day after 8am and summarizes what's left", () => {
    const state = emptyState();
    const early = new Date(2026, 9, 14, 7, 0).getTime();
    expect(dailyDigest([item(1, 5)], 0, state, early)).toBeNull();

    const digest = dailyDigest([item(1, 5), item(2, 50), item(3, 5, "submitted")], 2, state, NOW);
    expect(digest?.body).toMatch(/^1 due today, 2 due this week, 2 new announcements\. Next: Task 1/);
    expect(dailyDigest([item(1, 5)], 0, state, NOW + HOUR)).toBeNull();
  });

  it("says when nothing is left", () => {
    expect(dailyDigest([], 0, emptyState(), NOW)?.body).toBe("0 due this week. Nothing left to hand in.");
  });
});

describe("grade alerts", () => {
  const g = (key: string, displayed: string) => ({ key, courseName: "MATH 1", itemName: `Item ${key}`, displayed });

  it("records silently the first time, then reports new and changed grades", () => {
    const state = emptyState();
    expect(gradeAlerts([g("1:a", "8/10")], state)).toEqual([]);
    const notices = gradeAlerts([g("1:a", "9/10"), g("1:b", "A"), g("1:c", "")], state);
    expect(notices.map((n) => n.title)).toEqual(["New grade: Item 1:a", "New grade: Item 1:b"]);
    expect(gradeAlerts([g("1:a", "9/10"), g("1:b", "A")], state)).toEqual([]);
  });

  it("groups many new grades into one notice", () => {
    const state = emptyState();
    gradeAlerts([], state);
    const notices = gradeAlerts(["a", "b", "c", "d"].map((k) => g(k, "1")), state);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("4 new grades posted");
  });
});

it("prunes alert records older than 30 days", () => {
  const state = { alerted: { old: NOW - 31 * 24 * HOUR, fresh: NOW } };
  expect(Object.keys(pruneState(state, NOW).alerted)).toEqual(["fresh"]);
});
