import * as fs from "node:fs";
import * as path from "node:path";
import type { TokenManager } from "./token-manager.js";
import { loginWithBrowser, LoginError } from "./login.js";
import { NoBrowserError, ProfileInUseError } from "./browser.js";
import { loginLockPath, LOGIN_COMMAND, SETUP_COMMAND } from "../utils/paths.js";
import { log } from "../utils/logger.js";

export type AuthFailureKind =
  | "notConfigured"
  | "loginRequired"
  | "cancelled"
  | "timeout"
  | "noBrowser"
  | "busy"
  | "network"
  | "failed";

export class AuthRequiredError extends Error {
  constructor(readonly kind: AuthFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthRequiredError";
  }
}

export interface AuthenticatorOptions {
  baseUrl: string;
  tokenTtl: number;
  autoLogin: boolean;
  tokenManager: TokenManager;
  notify?: (message: string) => void;
}

const LOCK_STALE_MS = 12 * 60_000;
const COOLDOWN_MS = 2 * 60_000;

export class Authenticator {
  private inFlight: Promise<boolean> | null = null;
  private cooldownUntil = 0;

  constructor(private readonly options: AuthenticatorOptions) {}

  run(): Promise<boolean> {
    this.inFlight ??= this.authenticate().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async authenticate(): Promise<boolean> {
    const { baseUrl, tokenManager } = this.options;
    if (!baseUrl) {
      throw new AuthRequiredError("notConfigured", `Brightspace is not set up yet. Run \`${SETUP_COMMAND}\` in a terminal.`);
    }
    if (Date.now() < this.cooldownUntil) {
      throw new AuthRequiredError("cancelled", `Sign-in was cancelled recently. Run \`${LOGIN_COMMAND}\` in a terminal, or ask again in a couple of minutes.`);
    }

    const lock = await acquireLock();
    if (!lock) {
      // Another process signed in (or is signing in) for us; use what it saved.
      return (await tokenManager.getToken()) !== null;
    }

    try {
      // Another process may have finished just before we got the lock.
      if (await tokenManager.getToken()) return true;
      return await this.signIn();
    } finally {
      lock.release();
    }
  }

  private async signIn(): Promise<boolean> {
    const { baseUrl, tokenTtl, autoLogin, tokenManager } = this.options;
    const notify = this.options.notify ?? (() => {});
    try {
      log("INFO", "Trying silent sign-in with the saved browser profile");
      const { token } = await loginWithBrowser({ baseUrl, mode: "silent", tokenTtlSeconds: tokenTtl });
      await tokenManager.setToken(token);
      log("INFO", "Silent sign-in succeeded");
      return true;
    } catch (error) {
      if (!(error instanceof LoginError && error.kind === "needsInteraction")) throw toAuthError(error);
    }

    if (!autoLogin) {
      throw new AuthRequiredError("loginRequired", `Your Brightspace session expired. Run \`${LOGIN_COMMAND}\` in a terminal to sign in again.`);
    }

    try {
      notify("Your Brightspace session expired. A browser window is opening so you can sign in again.");
      const { token, displayName } = await loginWithBrowser({ baseUrl, mode: "interactive", tokenTtlSeconds: tokenTtl, onStatus: notify });
      await tokenManager.setToken(token);
      log("INFO", `Interactive sign-in succeeded${displayName ? ` for ${displayName}` : ""}`);
      return true;
    } catch (error) {
      if (error instanceof LoginError && (error.kind === "cancelled" || error.kind === "timeout")) {
        this.cooldownUntil = Date.now() + COOLDOWN_MS;
      }
      throw toAuthError(error);
    }
  }
}

function toAuthError(error: unknown): AuthRequiredError {
  if (error instanceof AuthRequiredError) return error;
  if (error instanceof NoBrowserError) return new AuthRequiredError("noBrowser", error.message, { cause: error });
  if (error instanceof ProfileInUseError) return new AuthRequiredError("busy", error.message, { cause: error });
  if (error instanceof LoginError) {
    const guidance: Record<LoginError["kind"], [AuthFailureKind, string]> = {
      cancelled: ["cancelled", "The sign-in window was closed before signing in finished."],
      timeout: ["timeout", "Sign-in was not completed within 10 minutes."],
      needsInteraction: ["loginRequired", "Your Brightspace session expired."],
      network: ["network", "Brightspace could not be reached. Check your connection and try again."],
      failed: ["failed", "Signing in to Brightspace did not complete."],
    };
    const [kind, text] = guidance[error.kind];
    return new AuthRequiredError(kind, `${text} Run \`${LOGIN_COMMAND}\` in a terminal to sign in.`, { cause: error });
  }
  log("ERROR", "Unexpected sign-in failure", error);
  return new AuthRequiredError("failed", `Signing in to Brightspace did not complete. Run \`${LOGIN_COMMAND}\` in a terminal to sign in.`, { cause: error });
}

async function acquireLock(): Promise<{ release: () => void } | null> {
  const file = loginLockPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let waited = false;
  const deadline = Date.now() + LOCK_STALE_MS;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      fs.closeSync(fd);
      if (waited) {
        fs.rmSync(file, { force: true });
        return null;
      }
      return { release: () => fs.rmSync(file, { force: true }) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (lockIsStale(file)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    waited = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new AuthRequiredError("busy", "Another sign-in is still in progress. Finish it, then try again.");
}

function lockIsStale(file: string): boolean {
  try {
    const { pid, startedAt } = JSON.parse(fs.readFileSync(file, "utf8")) as { pid: number; startedAt: number };
    if (Date.now() - startedAt > LOCK_STALE_MS) return true;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // ESRCH: the owner died. Unreadable: a crash mid-write.
    return (error as NodeJS.ErrnoException)?.code !== "EPERM";
  }
}
