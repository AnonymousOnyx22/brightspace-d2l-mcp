import { describe, it, expect, vi } from "vitest";
import { registerGetDiscussions } from "../../src/tools/get-discussions.js";
import { ApiError } from "../../src/api/index.js";

const COURSE_ID = 101;
const BASE = `/d2l/api/le/1.0/${COURSE_ID}/discussions/forums`;

/** Captures the registered handler and answers get() from a path map. */
function setup(responses: Record<string, unknown>) {
  const apiClient = {
    le: (orgUnitId: number, p: string) => `/d2l/api/le/1.0/${orgUnitId}${p}`,
    get: vi.fn(async (path: string) => {
      const value = responses[path];
      if (value instanceof Error) throw value;
      if (value === undefined) throw new ApiError(404, path, "not found");
      return value;
    }),
  };

  let handler: (args: unknown) => Promise<any>;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: (args: unknown) => Promise<any>) => {
      handler = fn;
    },
  };

  registerGetDiscussions(server as any, apiClient as any);
  return { call: (args: unknown) => handler!(args), apiClient };
}

const parse = (result: any) => JSON.parse(result.content[0].text);

const forum = (id: number, name: string) => ({
  ForumId: id,
  Name: name,
  Description: { Text: `${name} text`, Html: "" },
  IsLocked: false,
  IsHidden: false,
});

const topic = (forumId: number, id: number, name: string) => ({
  ForumId: forumId,
  TopicId: id,
  Name: name,
  Description: { Text: "plain", Html: "<p>Say <strong>hello</strong></p>" },
  DueDate: "2026-03-01T00:00:00Z",
  IsLocked: false,
  IsHidden: false,
  MustPostToParticipate: true,
  ScoreOutOf: 10,
});

const post = (id: number, over: Record<string, unknown> = {}) => ({
  PostId: id,
  ThreadId: 1,
  ParentPostId: null,
  Subject: `Post ${id}`,
  Message: { Text: "", Html: "<p>Body</p>" },
  PostingUserDisplayName: "Sam Student",
  DatePosted: "2026-02-01T10:00:00Z",
  IsAnonymous: false,
  IsDeleted: false,
  LastEditedDate: null,
  ReplyPostIds: [],
  WordCount: 1,
  AttachmentCount: 0,
  IsRead: true,
  ...over,
});

describe("get_discussions", () => {
  it("lists forums with their topics", async () => {
    const { call } = setup({
      [`${BASE}/`]: [forum(1, "General"), forum(2, "Labs")],
      [`${BASE}/1/topics/`]: [topic(1, 11, "Intro")],
      [`${BASE}/2/topics/`]: [],
    });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.forumCount).toBe(2);
    expect(out.forums[0].name).toBe("General");
    expect(out.forums[0].topics[0]).toMatchObject({
      topicId: 11,
      forumId: 1,
      name: "Intro",
      mustPostToParticipate: true,
      scoreOutOf: 10,
    });
    expect(out.forums[1].topics).toEqual([]);
  });

  it("keeps a forum with no topics when the topic request is forbidden", async () => {
    const { call } = setup({
      [`${BASE}/`]: [forum(1, "General")],
      [`${BASE}/1/topics/`]: new ApiError(403, "topics", "forbidden"),
    });

    const out = parse(await call({ courseId: COURSE_ID }));
    expect(out.forumCount).toBe(1);
    expect(out.forums[0].topics).toEqual([]);
  });

  it("returns a forum with topic posts, skipping deleted ones and sorting by date", async () => {
    const { call } = setup({
      [`${BASE}/1`]: forum(1, "General"),
      [`${BASE}/1/topics/`]: [topic(1, 11, "Intro")],
      [`${BASE}/1/topics/11/posts/`]: [
        post(2, { DatePosted: "2026-02-03T10:00:00Z" }),
        post(3, { IsDeleted: true }),
        post(1, { DatePosted: "2026-02-01T10:00:00Z", IsAnonymous: true }),
      ],
    });

    const out = parse(await call({ courseId: COURSE_ID, forumId: 1 }));
    expect(out.forum.name).toBe("General");
    expect(out.topicCount).toBe(1);
    const t = out.topics[0];
    expect(t.postCount).toBe(3);
    expect(t.posts.map((p: any) => p.postId)).toEqual([1, 2]);
    expect(t.posts[0].author).toBe("Anonymous");
    expect(t.posts[1].author).toBe("Sam Student");
    expect(t.posts[0].message).toContain("Body");
    expect(t.description).toContain("hello");
    expect(t.description).not.toContain("<p>");
  });

  it("keeps a topic with no posts when the posts request is forbidden", async () => {
    const { call } = setup({
      [`${BASE}/1`]: forum(1, "General"),
      [`${BASE}/1/topics/`]: [topic(1, 11, "Intro")],
      [`${BASE}/1/topics/11/posts/`]: new ApiError(403, "posts", "forbidden"),
    });

    const out = parse(await call({ courseId: COURSE_ID, forumId: 1 }));
    expect(out.topics[0].postCount).toBe(0);
    expect(out.topics[0].posts).toEqual([]);
  });

  it("returns the posts for one topic", async () => {
    const { call, apiClient } = setup({
      [`${BASE}/1/topics/11`]: topic(1, 11, "Intro"),
      [`${BASE}/1/topics/11/posts/`]: [post(1, { ReplyPostIds: [5, 6] })],
    });

    const out = parse(await call({ courseId: COURSE_ID, forumId: 1, topicId: 11 }));
    expect(out.forumId).toBe(1);
    expect(out.topic.name).toBe("Intro");
    expect(out.postCount).toBe(1);
    expect(out.posts[0].replyCount).toBe(2);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("asks for forumId when only topicId is given", async () => {
    const { call, apiClient } = setup({});

    const result = await call({ courseId: COURSE_ID, topicId: 11 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/topicId requires forumId/);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("returns an error result when the forum list fails", async () => {
    const { call } = setup({ [`${BASE}/`]: new Error("network down") });

    const result = await call({ courseId: COURSE_ID });
    expect(result.isError).toBe(true);
  });
});
