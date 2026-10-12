import { describe, it, expect, vi } from "vitest";
import { registerGetWhatsNew } from "../../src/tools/get-whats-new.js";
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

const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
const old = new Date(Date.now() - 40 * 86_400_000).toISOString();

function news(id: number, title: string, date: string, published = true) {
  return {
    Id: id, Title: title, Body: { Text: "", Html: "" }, CreatedBy: { DisplayName: "Prof" }, CreatedDate: date,
    StartDate: date, IsPublished: published, IsPinned: false, IsGlobal: false, Attachments: [],
  };
}

function setup(responses: Record<string, unknown>) {
  const apiClient = {
    lp: (p: string) => `/lp${p}`,
    le: (id: number, p: string) => `/le/${id}${p}`,
    get: vi.fn(async (path: string) => {
      const key = Object.keys(responses).find((k) => path.startsWith(k));
      if (!key) throw Object.assign(new Error("not found"), { status: 404 });
      return responses[key];
    }),
  };
  let handler: (args: unknown) => Promise<any>;
  const server = { registerTool: (_n: string, _m: unknown, fn: any) => (handler = fn) };
  registerGetWhatsNew(server as any, apiClient as any, config);
  return (args: unknown) => handler!(args);
}

describe("get_whats_new", () => {
  it("sums unread counts, keeps only recent published announcements and lists quiet courses", async () => {
    const call = setup({
      "/lp/enrollments": enrollments,
      "/le/1/updates": { UnreadDiscussions: 3, UnattemptedQuizzes: 1, UnreadAssignmentFeedback: 2 },
      "/le/1/news": [news(1, "Lab moved", recent), news(2, "Old", old), news(3, "Draft", recent, false)],
      "/le/2/updates": { UnreadDiscussions: 0, UnattemptedQuizzes: 0, UnreadAssignmentFeedback: 0 },
      "/le/2/news": [],
    });

    const data = JSON.parse((await call({})).content[0].text);
    expect(data.totals).toEqual({ newAnnouncements: 1, unreadFeedback: 2, unreadDiscussions: 3, unattemptedQuizzes: 1 });
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0].newAnnouncements.map((a: any) => a.title)).toEqual(["Lab moved"]);
    expect(data.quietCourses).toEqual(["Calculus"]);
  });

  it("still reports announcements when the updates endpoint is unavailable", async () => {
    const call = setup({
      "/lp/enrollments": enrollments,
      "/le/1/news": [news(1, "Exam room", recent)],
      "/le/2/news": [],
    });

    const data = JSON.parse((await call({})).content[0].text);
    expect(data.courses[0]).toMatchObject({ courseName: "Networking", unreadFeedback: null });
    expect(data.totals.newAnnouncements).toBe(1);
  });
});
