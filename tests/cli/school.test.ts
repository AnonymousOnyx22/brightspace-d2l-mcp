import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSchool } from "../../src/cli/school.js";
import { normalizeSchoolUrl } from "../../src/utils/config.js";

const brightspace = new Set(["https://school-two.desire2learn.com", "https://purdue.brightspace.com"]);

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const origin = new URL(url).origin;
    if (brightspace.has(origin)) {
      return new Response(JSON.stringify([{ ProductCode: "lp" }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (origin === "https://learn.blackboard.example") {
      return new Response("", { status: 302, headers: { "x-blackboard-product": "Blackboard Learn" } });
    }
    if (origin.includes("unreachable")) throw new TypeError("fetch failed");
    return new Response("not found", { status: 404 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("normalizeSchoolUrl", () => {
  it("accepts bare hosts, full links and quoted pastes", () => {
    expect(normalizeSchoolUrl("school-two.desire2learn.com")).toBe("https://school-two.desire2learn.com");
    expect(normalizeSchoolUrl("https://purdue.brightspace.com/d2l/le/content/1/Home?x=1")).toBe("https://purdue.brightspace.com");
    expect(normalizeSchoolUrl(' "http://school.example/d2l/home" ')).toBe("https://school.example");
  });

  it("rejects things that are not addresses", () => {
    expect(normalizeSchoolUrl("")).toBeNull();
    expect(normalizeSchoolUrl("localhost")).toBeNull();
    expect(normalizeSchoolUrl("https://user:pass@school.example")).toBeNull();
  });
});

describe("resolveSchool", () => {
  it("verifies a pasted Brightspace link", async () => {
    mockFetch();
    await expect(resolveSchool("https://school-two.desire2learn.com/d2l/home")).resolves.toEqual({ ok: true, baseUrl: "https://school-two.desire2learn.com" });
  });

  it("finds a school from its short name", async () => {
    mockFetch();
    await expect(resolveSchool("purdue")).resolves.toEqual({ ok: true, baseUrl: "https://purdue.brightspace.com" });
    await expect(resolveSchool("school-two")).resolves.toEqual({ ok: true, baseUrl: "https://school-two.desire2learn.com" });
  });

  it("explains a sign-in page, another LMS, and an unreachable host", async () => {
    mockFetch();
    const idp = await resolveSchool("https://login.microsoftonline.com/tenant/saml2");
    expect(idp.ok || idp.reason).toContain("sign-in page");
    const other = await resolveSchool("learn.blackboard.example");
    expect(other.ok || other.reason).toContain("Blackboard");
    const down = await resolveSchool("unreachable.example");
    expect(down.ok || down.reason).toContain("Couldn't reach");
  });
});
