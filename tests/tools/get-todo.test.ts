import { describe, expect, it } from "vitest";
import { buildTodo } from "../../src/tools/get-todo.js";
import type { DueItem } from "../../src/tools/get-upcoming-due-dates.js";

const now = Date.parse("2026-09-16T18:00:00Z");

function item(title: string, dueDate: string, submissionStatus: DueItem["submissionStatus"]): DueItem {
  return {
    type: submissionStatus === "unknown" ? "quiz" : "assignment",
    id: title.length,
    title,
    courseId: 1,
    courseName: "Course",
    dueDate,
    startDate: null,
    endDate: null,
    url: "https://school.example/x",
    submitted: submissionStatus === "submitted" ? true : submissionStatus === "not_submitted" ? false : null,
    submissionStatus,
    submittedDate: submissionStatus === "submitted" ? "2026-09-15T00:00:00Z" : null,
  };
}

describe("buildTodo", () => {
  const todo = buildTodo(
    [
      item("Late lab", "2026-09-15T04:00:00Z", "not_submitted"),
      item("Lab 1", "2026-09-19T04:00:00Z", "submitted"),
      item("Lab 01", "2026-09-20T04:00:00Z", "not_open_yet"),
      item("Notebook", "2026-09-22T04:00:00Z", "not_submitted"),
      item("Draft essay", "2026-09-18T04:00:00Z", "draft"),
      item("Quiz", "2026-09-21T04:00:00Z", "unknown"),
    ],
    now,
  );

  it("never lists submitted work as something to do", () => {
    const actionable = [...todo.doNow, ...todo.overdue].map((i) => i.title);
    expect(actionable).not.toContain("Lab 1");
    expect(todo.alreadyDone.map((i) => i.title)).toEqual(["Lab 1"]);
  });

  it("sorts work into do now, overdue, not open yet and check yourself", () => {
    expect(todo.doNow.map((i) => i.title)).toEqual(["Draft essay", "Notebook"]);
    expect(todo.overdue.map((i) => i.title)).toEqual(["Late lab"]);
    expect(todo.notOpenYet.map((i) => i.title)).toEqual(["Lab 01"]);
    expect(todo.checkYourself.map((i) => i.title)).toEqual(["Quiz"]);
  });

  it("adds hours until due", () => {
    expect(todo.doNow.find((i) => i.title === "Draft essay")?.hoursUntilDue).toBe(34);
  });
});
