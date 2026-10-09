import { loadConfig } from "../utils/config.js";
import { configPath, dataDir, PACKAGE_NAME, SETUP_COMMAND } from "../utils/paths.js";
import { packageVersion } from "../utils/version.js";
import { TokenManager } from "../auth/index.js";
import { detectClients, isConfiguredIn } from "./clients.js";
import * as ui from "./ui.js";

export type CheckLevel = "ok" | "warn" | "fail";

export interface CheckResult {
  level: CheckLevel;
  message: string;
  /** What to do next. Shown under the result when something is wrong. */
  fix?: string;
}

const MIN_NODE_MAJOR = 20;
const NETWORK_TIMEOUT_MS = 8000;

export function checkNodeVersion(version: string = process.versions.node): CheckResult {
  const major = parseInt(version.split(".")[0] ?? "0", 10);
  if (major >= MIN_NODE_MAJOR) return { level: "ok", message: `Node.js ${version}` };
  return {
    level: "fail",
    message: `Node.js ${version} is too old (need ${MIN_NODE_MAJOR} or newer)`,
    fix: "Install the current LTS from https://nodejs.org and open a new terminal.",
  };
}

/** True when `latest` is a higher dotted version than `current`. Ignores pre-release tags. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.split("-")[0]!.split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
}

export function checkSchool(baseUrl: string | null | undefined): CheckResult {
  if (baseUrl) return { level: "ok", message: `School: ${baseUrl}` };
  return { level: "fail", message: "No school saved yet", fix: `Run: ${SETUP_COMMAND}` };
}

export async function checkConnectivity(baseUrl: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(baseUrl, { method: "HEAD", redirect: "follow" });
    // Any HTTP answer means the site is reachable. Sign-in redirects and 401s are normal.
    return { level: "ok", message: `Brightspace is reachable (HTTP ${response.status})` };
  } catch {
    return {
      level: "fail",
      message: `Can't reach ${baseUrl}`,
      fix: "Check your internet, VPN or campus network. Some schools only allow on-campus access.",
    };
  }
}

async function checkSession(baseUrl: string, tokenTtl: number | undefined): Promise<CheckResult> {
  try {
    const token = await new TokenManager({ baseUrl, tokenTtl }).getToken();
    if (token) return { level: "ok", message: "Saved sign-in is valid" };
    return {
      level: "warn",
      message: "Saved sign-in has expired",
      fix: "It reopens sign-in on your next question. To do it now, run: npx -y brightspace-d2l-mcp@latest login",
    };
  } catch (error) {
    return {
      level: "warn",
      message: "Couldn't read the saved sign-in",
      fix: `Run: npx -y brightspace-d2l-mcp@latest login${error instanceof Error ? ` (${error.message})` : ""}`,
    };
  }
}

export async function checkLatestVersion(current: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
    if (!response.ok) throw new Error(String(response.status));
    const { version } = (await response.json()) as { version?: string };
    if (version && isNewerVersion(version, current)) {
      return {
        level: "warn",
        message: `Version ${current} installed, ${version} is available`,
        fix: `Using npx with @latest updates itself. Otherwise run: npm install -g ${PACKAGE_NAME}@latest`,
      };
    }
    return { level: "ok", message: `Version ${current} is up to date` };
  } catch {
    return { level: "warn", message: `Version ${current} (couldn't check for updates)` };
  }
}

function checkClients(): CheckResult[] {
  const clients = detectClients();
  if (!clients.length) {
    return [
      {
        level: "warn",
        message: "No supported AI apps found on this computer",
        fix: `Run ${SETUP_COMMAND} again once one is installed, or use: npx -y ${PACKAGE_NAME}@latest config`,
      },
    ];
  }
  return clients.map((client): CheckResult =>
    isConfiguredIn(client)
      ? { level: "ok", message: `${client.name} is connected` }
      : { level: "warn", message: `${client.name} isn't connected`, fix: `Run: ${SETUP_COMMAND}` },
  );
}

function print(result: CheckResult): void {
  if (result.level === "ok") ui.ok(result.message);
  else if (result.level === "warn") ui.warn(result.message);
  else ui.fail(result.message);
  if (result.fix && result.level !== "ok") ui.info(ui.dim(`   ${result.fix}`));
}

/** Runs every check, prints the result and returns 1 if anything failed outright. */
export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  const results: CheckResult[] = [];
  const add = (...items: CheckResult[]) => {
    for (const item of items) {
      results.push(item);
      print(item);
    }
  };

  console.log(`\n${ui.bold("brightspace-d2l-mcp doctor")} ${ui.dim(`v${packageVersion()}`)}\n`);

  add(checkNodeVersion());
  add(checkSchool(config.baseUrl));
  if (config.baseUrl) {
    add(await checkConnectivity(config.baseUrl));
    add(await checkSession(config.baseUrl, config.tokenTtl));
  }
  add(...checkClients());
  add(await checkLatestVersion(packageVersion()));

  const failures = results.filter((r) => r.level === "fail").length;
  const warnings = results.filter((r) => r.level === "warn").length;
  console.log();
  if (failures) ui.fail(`${failures} problem${failures === 1 ? "" : "s"} found. Fix the first one above and run doctor again.`);
  else if (warnings) ui.warn(`No blocking problems, ${warnings} thing${warnings === 1 ? "" : "s"} worth a look.`);
  else ui.ok("Everything looks good.");
  ui.info(ui.dim(`Config: ${configPath()}  Data: ${dataDir()}`));
  console.log();
  return failures ? 1 : 0;
}
