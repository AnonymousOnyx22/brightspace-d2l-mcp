import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { registerExportDueDatesCalendar, CALENDAR_FILENAME } from "../../src/tools/export-due-dates-calendar.js";
import { collectDueItems } from "../../src/tools/get-upcoming-due-dates.js";
import type { CalendarItem } from "../../src/utils/ics.js";
import type { AppConfig } from "../../src/types/index.js";

vi.mock("../../src/utils/logger.js", () => ({ log: vi.fn() }));
vi.mock("../../src/tools/get-upcoming-due-dates.js", () => ({ collectDueItems: vi.fn() }));

const config = { baseUrl: "https://brightspace.example.edu" } as AppConfig;
const collect = vi.mocked(collectDueItems);

function item(id: number, overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    type: "assignment",
    id,
    title: `Task ${id}`,
    courseId: 1,
    courseName: "Networking",
    dueDate: "2030-01-15T17:00:00.000Z",
    url: `https://brightspace.example.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id}&ou=1`,
    submissionStatus: "not_submitted",
    ...overrides,
  };
}

function setup() {
  let handler: (args: unknown) => Promise<any>;
  const server = { registerTool: (_n: string, _m: unknown, fn: any) => (handler = fn) };
  registerExportDueDatesCalendar(server as any, {} as any, config);
  return (args: unknown) => handler!(args);
}

describe("export_due_dates_calendar", () => {
  beforeEach(() => collect.mockReset());

  it("returns calendar text with one event per unfinished item", async () => {
    collect.mockResolvedValue([
      item(1),
      item(2, { type: "quiz", title: "Quiz, week 3", submissionStatus: "not_submitted" }),
      item(3, { submissionStatus: "submitted" }),
      item(4, { submissionStatus: "graded" }),
    ] as any);

    const data = JSON.parse((await setup()({})).content[0].text);
    expect(data.eventCount).toBe(2);
    expect(data.filename).toBe(CALENDAR_FILENAME);
    expect(data.ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(data.ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(data.ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(data.ics).toContain("UID:assignment-1-1@brightspace-d2l-mcp");
    expect(data.ics).toContain("UID:quiz-1-2@brightspace-d2l-mcp");
    expect(data.ics).toContain("SUMMARY:Networking: Quiz\\, week 3");
    expect(data.ics).toContain("DTSTART:20300115T163000Z");
    expect(data.ics).toContain("DTEND:20300115T170000Z");
    expect(data.ics).toContain("TRIGGER:-P1D");
    expect(data.ics).not.toContain("assignment-1-3@");
  });

  it("includes submitted work when includeSubmitted is true", async () => {
    collect.mockResolvedValue([item(1), item(3, { submissionStatus: "submitted" })] as any);

    const data = JSON.parse((await setup()({ includeSubmitted: true })).content[0].text);
    expect(data.eventCount).toBe(2);
    expect(data.ics).toContain("Status: Submitted");
  });

  it("passes the window and course filter to the due date lookup", async () => {
    collect.mockResolvedValue([]);

    const data = JSON.parse((await setup()({ daysAhead: 7, courseId: 5 })).content[0].text);
    expect(data.eventCount).toBe(0);
    expect(data.ics).not.toContain("BEGIN:VEVENT");
    expect(collect).toHaveBeenCalledWith(expect.anything(), config, { fromMs: 0, toMs: 7 * 86_400_000, courseId: 5 });
  });

  it("rejects a relative downloadPath", async () => {
    const result = await setup()({ downloadPath: "relative/folder" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("absolute path");
    expect(collect).not.toHaveBeenCalled();
  });

  it("saves the file when downloadPath is given", async () => {
    collect.mockResolvedValue([item(1)] as any);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ics-test-"));
    try {
      const target = path.join(dir, "nested");
      const data = JSON.parse((await setup()({ downloadPath: target })).content[0].text);
      expect(data).toEqual({ eventCount: 1, savedTo: path.join(target, CALENDAR_FILENAME) });
      expect(data.ics).toBeUndefined();
      const saved = await fs.readFile(data.savedTo, "utf8");
      expect(saved).toContain("UID:assignment-1-1@brightspace-d2l-mcp");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
