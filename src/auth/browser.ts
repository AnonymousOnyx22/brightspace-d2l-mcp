import * as fs from "node:fs";
import type { BrowserContext } from "playwright-core";
import { browserProfileDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

export class NoBrowserError extends Error {
  constructor(detail: string) {
    super(
      "No supported browser was found. Install Google Chrome or Microsoft Edge, " +
      "or run `npx playwright install chromium`, then try again." + (detail ? ` (${detail})` : ""),
    );
    this.name = "NoBrowserError";
  }
}

export class ProfileInUseError extends Error {
  constructor() {
    super("The sign-in browser is already open. Finish signing in there, or close it and try again.");
    this.name = "ProfileInUseError";
  }
}

interface Candidate {
  label: string;
  channel?: string;
  executablePath?: string;
}

function candidates(): Candidate[] {
  const custom = process.env.BRIGHTSPACE_BROWSER_PATH;
  if (custom) return [{ label: custom, executablePath: custom }];
  return [
    { label: "Google Chrome", channel: "chrome" },
    { label: "Microsoft Edge", channel: "msedge" },
    { label: "Chromium (Playwright)" },
  ];
}

let preferred: Candidate | null = null;

function isMissingExecutable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|is not found at|not installed|Chromium distribution .* is not found|Failed to launch/i.test(message)
    && !isProfileInUse(error);
}

function isProfileInUse(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ProcessSingleton|profile (?:appears to be )?in use|user data directory is already in use|SingletonLock/i.test(message);
}

export async function launchBrowser(options: { headless: boolean }): Promise<BrowserContext> {
  const { chromium } = await import("playwright-core");
  const profile = browserProfileDir();
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });

  const order = preferred ? [preferred, ...candidates().filter((c) => c.label !== preferred!.label)] : candidates();
  const failures: string[] = [];
  for (const candidate of order) {
    try {
      const context = await chromium.launchPersistentContext(profile, {
        headless: options.headless,
        channel: candidate.channel,
        executablePath: candidate.executablePath,
        viewport: options.headless ? { width: 1280, height: 800 } : null,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
        timeout: 60_000,
      });
      preferred = candidate;
      log("DEBUG", `Launched ${candidate.label} (${options.headless ? "hidden" : "visible"})`);
      if (options.headless) await hideHeadlessUserAgent(context);
      return context;
    } catch (error) {
      if (isProfileInUse(error)) throw new ProfileInUseError();
      if (!isMissingExecutable(error)) throw error;
      failures.push(candidate.label);
    }
  }
  throw new NoBrowserError(`tried ${failures.join(", ")}`);
}

async function hideHeadlessUserAgent(context: BrowserContext): Promise<void> {
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const ua = await page.evaluate(() => navigator.userAgent);
    if (ua.includes("HeadlessChrome")) {
      await context.setExtraHTTPHeaders({ "user-agent": ua.replace("HeadlessChrome", "Chrome") });
    }
  } catch (error) {
    log("DEBUG", "Could not adjust headless user agent", error);
  }
}
