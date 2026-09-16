import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({ log: vi.fn() }));
vi.mock("../../src/auth/login.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/login.js")>();
  return { ...actual, loginWithBrowser: vi.fn() };
});

const { Authenticator, AuthRequiredError } = await import("../../src/auth/authenticator.js");
const { loginWithBrowser, LoginError } = await import("../../src/auth/login.js");
const login = vi.mocked(loginWithBrowser);

const token = { accessToken: "jwt", tenantOrigin: "https://school.example", capturedAt: 1, expiresAt: Date.now() + 3_600_000, source: "browser" as const };

function makeTokenManager() {
  let saved: typeof token | null = null;
  return {
    getToken: vi.fn(async () => saved),
    setToken: vi.fn(async (t: typeof token) => { saved = t; }),
  };
}

function makeAuthenticator(options: { autoLogin?: boolean; baseUrl?: string } = {}) {
  const tokenManager = makeTokenManager();
  const notify = vi.fn();
  const authenticator = new Authenticator({
    baseUrl: options.baseUrl ?? "https://school.example",
    tokenTtl: 3600,
    autoLogin: options.autoLogin ?? true,
    tokenManager: tokenManager as never,
    notify,
  });
  return { authenticator, tokenManager, notify };
}

beforeEach(() => {
  process.env.BRIGHTSPACE_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "bsm-auth-"));
  login.mockReset();
});

afterEach(() => {
  fs.rmSync(process.env.BRIGHTSPACE_MCP_HOME!, { recursive: true, force: true });
  delete process.env.BRIGHTSPACE_MCP_HOME;
});

describe("Authenticator", () => {
  it("uses silent sign-in when the saved browser session still works", async () => {
    login.mockResolvedValueOnce({ token, displayName: "Student" });
    const { authenticator, tokenManager, notify } = makeAuthenticator();

    await expect(authenticator.run()).resolves.toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][0].mode).toBe("silent");
    expect(tokenManager.setToken).toHaveBeenCalledWith(token);
    expect(notify).not.toHaveBeenCalled();
  });

  it("opens a visible window when silent sign-in needs a person", async () => {
    login
      .mockRejectedValueOnce(new LoginError("needsInteraction", "expired"))
      .mockResolvedValueOnce({ token, displayName: "Student" });
    const { authenticator, notify } = makeAuthenticator();

    await expect(authenticator.run()).resolves.toBe(true);
    expect(login.mock.calls.map((c) => c[0].mode)).toEqual(["silent", "interactive"]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("browser window"));
  });

  it("asks for the login command instead of opening a window when autoLogin is off", async () => {
    login.mockRejectedValueOnce(new LoginError("needsInteraction", "expired"));
    const { authenticator } = makeAuthenticator({ autoLogin: false });

    await expect(authenticator.run()).rejects.toMatchObject({ kind: "loginRequired" });
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("does not reopen the window right after the person closed it", async () => {
    login
      .mockRejectedValueOnce(new LoginError("needsInteraction", "expired"))
      .mockRejectedValueOnce(new LoginError("cancelled", "closed"));
    const { authenticator } = makeAuthenticator();

    await expect(authenticator.run()).rejects.toMatchObject({ kind: "cancelled" });
    await expect(authenticator.run()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("shares one sign-in between concurrent tool calls", async () => {
    login.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { token, displayName: null };
    });
    const { authenticator } = makeAuthenticator();

    await Promise.all([authenticator.run(), authenticator.run(), authenticator.run()]);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("explains how to set up when no school is configured", async () => {
    const { authenticator } = makeAuthenticator({ baseUrl: "" });
    await expect(authenticator.run()).rejects.toMatchObject({ kind: "notConfigured" });
    expect(login).not.toHaveBeenCalled();
  });
});
