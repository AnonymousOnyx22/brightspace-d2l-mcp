import { describe, it, expect, vi } from "vitest";
import { registerGetCalendarEvents } from "../../src/tools/get-calendar-events.js";
import type { AppConfig } from "../../src/types/index.js";

const config = {
  baseUrl: "https://brightspace.example.edu",
  courseFilter: { activeOnly: true },
} as AppConfig;

const enrollments = {
  Items: [
    { OrgUnit: { Id: 1, Name: "Networking", Code: "NET" }, Access: { IsActive: true } },
    { OrgUnit: { Id: 2, Name: "Calculus", Code: "MATH" }, Access: { IsActive: true } },
  ],
};

function setup(responses: Record<string, unknown>) {
  const requested: string[] = [];
  const apiClient = {
    lp: (p: string) => `/lp${p}`,
    le: (id: number, p: string) => `/le/${id}${p}`,
    get: vi.fn(async (path: string) => {
      requested.push(path);
      const key = Object.keys(responses).find((k) => path.startsWith(k));
      if (!key) throw Object.assign(new Error("not found"), { status: 404 });
      const value = responses[key];
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  let handler: (args: unknown) => Promise<any>;
  const server = { registerTool: (_n: string, _m: unknown, fn: any) => (handler = fn) };
  registerGetCalendarEvents(server as any, apiClient as any, config);
  return { call: (args: unknown) => handler!(args), requested };
}

const parse = (result: any) => JSON.parse(result.content[0].text);

describe("get_calendar_events", () => {
  it("merges events across courses, soonest first, from both response shapes", async () => {
    const { call, requested } = setup({
      "/lp/enrollments": enrollments,
      "/le/1/calendar": [
        { CalendarEventId: 10, Title: "Final exam", StartDateTime: "2026-12-10T14:00:00.000Z", EndDateTime: "2026-12-10T16:00:00.000Z", LocationName: "Gym" },
      ],
      "/le/2/calendar": {
        Objects: [{ CalendarEventId: 20, Title: "Midterm", StartDateTime: "2026-11-01T14:00:00.000Z", AssociatedEntity: null }],
        Next: null,
      },
    });

    const data = parse(await call({}));
    expect(data.events.map((e: any) => e.title)).toEqual(["Midterm", "Final exam"]);
    expect(data.events[1]).toMatchObject({ courseName: "Networking", location: "Gym", allDay: false });
    expect(requested.some((p) => p.includes("startDateTime=") && p.includes("endDateTime="))).toBe(true);
  });

  it("filters by search text and skips courses that fail", async () => {
    const { call } = setup({
      "/lp/enrollments": enrollments,
      "/le/1/calendar": [
        { CalendarEventId: 10, Title: "Final exam", StartDateTime: "2026-12-10T14:00:00.000Z" },
        { CalendarEventId: 11, Title: "Lab", StartDateTime: "2026-12-01T14:00:00.000Z" },
      ],
      "/le/2/calendar": Object.assign(new Error("forbidden"), { status: 403 }),
    });

    const data = parse(await call({ search: "EXAM" }));
    expect(data.events.map((e: any) => e.id)).toEqual([10]);
  });

  it("reports an error when the one requested course fails", async () => {
    const { call } = setup({
      "/lp/enrollments": enrollments,
      "/le/2/calendar": Object.assign(new Error("boom"), { status: 500 }),
    });
    const result = await call({ courseId: 2 });
    expect(result.isError).toBe(true);
  });
});
