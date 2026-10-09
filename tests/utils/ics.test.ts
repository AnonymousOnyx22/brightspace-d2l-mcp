import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine, type CalendarItem } from "../../src/utils/ics.js";

const item: CalendarItem = {
  type: "assignment",
  id: 7,
  title: "Lab 3, Part A; routing",
  courseId: 42,
  courseName: "Networking 101",
  dueDate: "2026-10-14T03:59:00.000Z",
  url: "https://school.brightspace.com/d2l/lms/dropbox/user/folders_list.d2l?ou=42",
  submissionStatus: "not_submitted",
};

describe("buildIcs", () => {
  const ics = buildIcs([item], Date.parse("2026-10-09T12:00:00Z"));

  it("produces a valid calendar envelope with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("ends the event at the due time and starts it 30 minutes earlier", () => {
    expect(ics).toContain("DTEND:20261014T035900Z");
    expect(ics).toContain("DTSTART:20261014T032900Z");
  });

  it("uses a stable UID so re-imports update instead of duplicating", () => {
    expect(ics).toContain("UID:assignment-42-7@brightspace-d2l-mcp");
  });

  it("escapes commas and semicolons in the title", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Networking 101: Lab 3\\, Part A\\; routing");
  });

  it("skips items with an invalid date", () => {
    expect(buildIcs([{ ...item, dueDate: "not a date" }])).not.toContain("BEGIN:VEVENT");
  });
});

describe("ics helpers", () => {
  it("escapes backslashes and newlines", () => {
    expect(escapeIcsText("a\\b\nc")).toBe("a\\\\b\\nc");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const folded = foldIcsLine("X:" + "é".repeat(80));
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("X:" + "é".repeat(80));
  });
});
