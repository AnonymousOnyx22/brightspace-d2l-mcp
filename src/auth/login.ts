import * as fs from "node:fs";
import * as path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import type { TokenData } from "../types/index.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { savedCookiesPath } from "../utils/paths.js";
import { readStoredConfig, writeStoredConfig } from "../utils/config.js";
import { launchBrowser } from "./browser.js";
import { mintAccessToken } from "./token-mint.js";
import { log } from "../utils/logger.js";

export type LoginMode = "silent" | "interactive";

export type LoginFailure = "cancelled" | "timeout" | "needsInteraction" | "network" | "failed";

export class LoginError extends Error {
  constructor(readonly kind: LoginFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoginError";
  }
}

export interface LoginOptions {
  baseUrl: string;
  mode: LoginMode;
  tokenTtlSeconds?: number;
  timeoutMs?: number;
  onStatus?: (message: string) => void;
}

export interface LoginResult {
  token: TokenData;
  displayName: string | null;
}

const POLL_MS = 1000;

export async function loginWithBrowser(options: LoginOptions): Promise<LoginResult> {
  const origin = new URL(options.baseUrl).origin;
  const interactive = options.mode === "interactive";
  const timeoutMs = options.timeoutMs ?? (interactive ? 10 * 60_000 : 45_000);
  const status = options.onStatus ?? (() => {});

  const context = await launchBrowser({ headless: !interactive });
  let closedByUser = false;
  context.on("close", () => { closedByUser = true; });

  // Remember which single sign-on entry the person used (an SSO button, a campus link),
  // so silent sign-in can follow it without anyone clicking.
  let ssoEntryUrl: string | null = null;
  context.on("request", (request) => {
    const url = safeUrl(request.url());
    if (url && url.origin === origin && /^\/d2l\/lp\/auth\/saml\/(login|initiate-login)/i.test(url.pathname) && request.isNavigationRequest()) {
      ssoEntryUrl = `${url.origin}${url.pathname}${url.search}`;
    }
  });

  try {
    await restoreCookies(context);
    const page = context.pages()[0] ?? (await context.newPage());
    if (interactive) {
      await page.bringToFront().catch(() => {});
      status("A browser window opened. Sign in to Brightspace there, the way you normally do.");
    }
    await page.goto(`${origin}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((error) => {
      // Single sign-on redirects can outlive the navigation timeout; keep watching.
      log("DEBUG", "Initial navigation did not settle", error);
    });

    const stored = readStoredConfig();
    const user = await waitForSession(context, origin, {
      deadline: Date.now() + timeoutMs,
      interactive,
      isClosed: () => closedByUser,
      ssoEntryUrl: stored.baseUrl === origin ? stored.ssoEntryUrl : undefined,
    });
    status(user.displayName ? `Signed in as ${user.displayName}.` : "Signed in.");

    const token = await captureToken(context, activePage(context) ?? page, origin, options.tokenTtlSeconds ?? 3600);
    await saveCookies(context);
    if (interactive && ssoEntryUrl && stored.baseUrl === origin && stored.ssoEntryUrl !== ssoEntryUrl) {
      writeStoredConfig({ ssoEntryUrl });
    }
    return { token, displayName: user.displayName };
  } catch (error) {
    if (error instanceof LoginError) throw error;
    if (closedByUser) throw new LoginError("cancelled", "The sign-in window was closed before signing in finished.");
    throw new LoginError("failed", `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    if (!closedByUser) await context.close().catch(() => {});
  }
}

interface SignedInUser {
  displayName: string | null;
}

async function waitForSession(
  context: BrowserContext,
  origin: string,
  watch: { deadline: number; interactive: boolean; isClosed: () => boolean; ssoEntryUrl?: string },
): Promise<SignedInUser> {
  let offOriginSince: number | null = null;
  let followedSsoEntry = false;
  while (Date.now() < watch.deadline) {
    if (watch.isClosed()) {
      throw new LoginError("cancelled", "The sign-in window was closed before signing in finished.");
    }
    const page = activePage(context);
    const url = safeUrl(page?.url());

    if (url && url.origin === origin && url.pathname.startsWith("/d2l/") && !url.pathname.startsWith("/d2l/login")) {
      const user = await whoami(context, origin);
      if (user) return user;
    }

    if (!watch.interactive) {
      // A D2L login page that waits for a button click: follow the entry the person used last time.
      if (page && url?.origin === origin && url.pathname.startsWith("/d2l/login") && watch.ssoEntryUrl && !followedSsoEntry) {
        followedSsoEntry = true;
        offOriginSince = null;
        log("DEBUG", "Following the saved single sign-on entry");
        await page.goto(watch.ssoEntryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        continue;
      }
      // Silent mode: parked on an identity provider or the D2L login page means a person is needed.
      const onLoginPage = !url || url.origin !== origin || url.pathname.startsWith("/d2l/login");
      offOriginSince = onLoginPage ? offOriginSince ?? Date.now() : null;
      if (offOriginSince && Date.now() - offOriginSince > 12_000) {
        throw new LoginError("needsInteraction", "The saved sign-in has expired; a person needs to sign in.");
      }
    }
    await sleep(POLL_MS);
  }
  throw new LoginError(
    watch.interactive ? "timeout" : "needsInteraction",
    watch.interactive ? "Sign-in was not completed in time." : "Silent sign-in did not finish.",
  );
}

function activePage(context: BrowserContext): Page | undefined {
  const pages = context.pages().filter((p) => !p.isClosed());
  const onBrightspace = pages.filter((p) => p.url().includes("/d2l/"));
  return onBrightspace.at(-1) ?? pages.at(-1);
}

async function whoami(context: BrowserContext, origin: string): Promise<SignedInUser | null> {
  try {
    const response = await context.request.get(`${origin}/d2l/api/lp/1.0/users/whoami`, { timeout: 10_000, failOnStatusCode: false });
    if (!response.ok() || !(response.headers()["content-type"] ?? "").includes("json")) return null;
    const body = (await response.json()) as { Identifier?: unknown; FirstName?: string; LastName?: string };
    if (body?.Identifier === undefined || body.Identifier === null || body.Identifier === "") return null;
    const name = [body.FirstName, body.LastName].filter(Boolean).join(" ").trim();
    return { displayName: name || null };
  } catch (error) {
    log("DEBUG", "whoami check failed", error);
    return null;
  }
}

async function captureToken(context: BrowserContext, page: Page, origin: string, ttlSeconds: number): Promise<TokenData> {
  if (!page.url().startsWith(`${origin}/d2l/home`)) {
    await page.goto(`${origin}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  }

  const cookies = await context.cookies(origin);
  const pick = (name: string) => cookies.find((c) => c.name === name);
  const session = pick("d2lSessionVal");
  const secure = pick("d2lSecureSessionVal");
  const cookieHeader = session && secure ? `d2lSessionVal=${session.value}; d2lSecureSessionVal=${secure.value}` : undefined;
  const csrfToken = (await readXsrfToken(page)) ?? undefined;

  const now = Date.now();
  const build = (accessToken: string): TokenData => ({
    accessToken,
    tenantOrigin: origin,
    capturedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    source: "browser",
    cookieHeader,
    csrfToken,
  });

  if (cookieHeader && csrfToken) {
    const minted = await mintAccessToken({ baseUrl: origin, cookieHeader, csrfToken });
    if (minted.ok) return build(minted.accessToken);
    if (minted.reason === "transport") {
      throw new LoginError("network", `Brightspace could not issue an API token right now (${minted.detail ?? "network"}).`);
    }
  }

  // Fallback: the token Brightspace's own web app caches for itself.
  const cached = await page.evaluate(() => {
    try {
      const tokens = JSON.parse(localStorage.getItem("D2L.Fetch.Tokens") ?? "null");
      return (tokens?.["*:*:*"]?.access_token as string | undefined) ?? null;
    } catch {
      return null;
    }
  }).catch(() => null);
  if (cached) return build(cached);

  throw new LoginError("failed", "Signed in, but Brightspace did not provide an API token.");
}

async function readXsrfToken(page: Page): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = await page.evaluate(() => {
      try {
        const xsrf = (window as unknown as { D2L?: { LP?: { Web?: { Authentication?: { Xsrf?: { GetXsrfToken?: () => string } } } } } })
          .D2L?.LP?.Web?.Authentication?.Xsrf;
        const value = xsrf?.GetXsrfToken?.call(xsrf);
        if (value) return value;
      } catch {
        // Not ready yet.
      }
      return document.querySelector('meta[name="d2l-xsrf-token"]')?.getAttribute("content") ?? null;
    }).catch(() => null);
    if (token) return token;
    await sleep(1000);
  }
  return null;
}

type Cookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    const file = savedCookiesPath();
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(file, JSON.stringify(cookies), { mode: 0o600 });
  } catch (error) {
    log("DEBUG", "Could not save sign-in cookies", error);
  }
}

async function restoreCookies(context: BrowserContext): Promise<void> {
  let cookies: Cookie[];
  try {
    cookies = JSON.parse(await fs.promises.readFile(savedCookiesPath(), "utf8")) as Cookie[];
  } catch {
    return;
  }
  const now = Date.now() / 1000;
  const live = cookies.filter((c) => c.expires === -1 || c.expires > now);
  // One malformed cookie must not block the rest.
  for (const cookie of live) {
    await context.addCookies([cookie]).catch(() => {});
  }
  log("DEBUG", `Restored ${live.length} sign-in cookies`);
}

function safeUrl(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
