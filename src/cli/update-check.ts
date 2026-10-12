import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { PACKAGE_NAME } from "../utils/paths.js";
import { packageVersion } from "../utils/version.js";
import { isNewerVersion } from "./doctor.js";
import * as ui from "./ui.js";

const CHECK_TIMEOUT_MS = 1500;
/** Set on the relaunched process so it never asks again. */
const RELAUNCHED_ENV = "BRIGHTSPACE_UPDATED";
/** Commands that never prompt: the MCP server itself, and output meant for scripts. */
const SKIP_COMMANDS = new Set(["serve", "config", "--version", "-v"]);

export function shouldCheckForUpdate(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, tty = process.stdin.isTTY === true && process.stdout.isTTY === true): boolean {
  if (!tty || SKIP_COMMANDS.has(command)) return false;
  if (args.includes("--yes") || args.includes("-y")) return false;
  return !env.CI && !env.BRIGHTSPACE_NO_UPDATE_CHECK && !env[RELAUNCHED_ENV];
}

async function latestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!response.ok) return null;
    const { version } = (await response.json()) as { version?: string };
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function relaunch(version: string, command: string, args: string[]): Promise<number> {
  const windows = process.platform === "win32";
  const argv = ["-y", `${PACKAGE_NAME}@${version}`, command, ...args];
  return new Promise((resolve) => {
    const child = spawn("npx", windows ? argv.map(quoteForCmd) : argv, {
      stdio: "inherit",
      shell: windows,
      // Run outside the current folder, so a project that itself depends on this package can't shadow the new version.
      cwd: homedir(),
      env: { ...process.env, [RELAUNCHED_ENV]: "1" },
    });
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Before an interactive command, offers to switch to a newer release.
 * Returns the exit code of the updated run, or null to carry on with this version.
 */
export async function offerUpdate(command: string, args: string[]): Promise<number | null> {
  if (!shouldCheckForUpdate(command, args)) return null;
  const current = packageVersion();
  const latest = await latestVersion();
  if (!latest || !isNewerVersion(latest, current)) return null;

  console.log(`\n  ${ui.yellow("↑")} ${ui.bold(`brightspace-d2l-mcp v${latest}`)} is out ${ui.dim(`(you have v${current})`)}`);
  if (!(await ui.confirm("Update now?"))) {
    ui.info(ui.dim(`Skipped. Run npx -y ${PACKAGE_NAME}@latest ${command} any time to update.`));
    return null;
  }

  ui.info(ui.dim(`Downloading v${latest}...`));
  const code = await relaunch(latest, command, args);
  if (code === -1) {
    ui.warn(`Couldn't start the update. Carrying on with v${current}.`);
    return null;
  }
  if (!process.argv[1]?.includes("_npx")) {
    ui.info(ui.dim(`To update your installed copy too, run: npm install -g ${PACKAGE_NAME}@latest`));
  }
  return code;
}
