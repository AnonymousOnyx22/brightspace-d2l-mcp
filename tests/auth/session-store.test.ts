import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../src/auth/session-store.js";

let dir: string;
const token = (accessToken: string) => ({ accessToken, tenantOrigin: "https://school.example", capturedAt: 1, expiresAt: 2, source: "browser" as const });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bsm-session-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("round-trips a session and clears it", async () => {
    const store = new SessionStore(path.join(dir, "nested", "session.json"));
    expect(await store.load()).toBeNull();
    await store.save(token("a"));
    expect(await store.load()).toEqual(token("a"));
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("does not overwrite a session another process saved meanwhile", async () => {
    const store = new SessionStore(path.join(dir, "session.json"));
    await store.save(token("newer"));
    expect(await store.saveIfCurrent(token("mine"), token("older"))).toBe(false);
    expect(await store.clearIfCurrent(token("older"))).toBe(false);
    expect((await store.load())?.accessToken).toBe("newer");
    expect(await store.saveIfCurrent(token("mine"), token("newer"))).toBe(true);
  });

  it("ignores a corrupt file instead of crashing", async () => {
    const file = path.join(dir, "session.json");
    fs.writeFileSync(file, "{not json");
    expect(await new SessionStore(file).load()).toBeNull();
  });
});
