import { execFileSync } from "node:child_process";
import { readStoredConfig, writeStoredConfig } from "../utils/config.js";
import { loginWithBrowser, LoginError, NoBrowserError, TokenManager } from "../auth/index.js";
import { SERVER_NAME } from "../utils/paths.js";
import { resolveSchool } from "./school.js";
import { installChromium } from "../auth/install-browser.js";
import { activateKey, startAlerts } from "../pro/cli.js";
import { readLicense } from "../pro/license.js";
import {
  addToClient,
  allowToolsInClaudeCode,
  detectClients,
  isClaudeDesktopRunning,
  quitClaudeDesktop,
  serverEntry,
  type ClientTarget,
} from "./clients.js";
import { canCloseWindow, closeWindowAfterCountdown } from "./close-window.js";
import * as ui from "./ui.js";

export interface SetupFlags {
  school?: string;
  yes?: boolean;
  skipLogin?: boolean;
  apps?: string[];
  /** Leave the terminal window open when setup finishes. */
  keepOpen?: boolean;
  /** Subscription key from brightspacemcp.com. */
  key?: string;
}

export async function runSetup(flags: SetupFlags): Promise<number> {
  const code = await setupSteps(flags);
  if (code === 0 && !flags.keepOpen && canCloseWindow()) await closeWindowAfterCountdown();
  return code;
}

async function setupSteps(flags: SetupFlags): Promise<number> {
  if (flags.yes) ui.setNonInteractive();

  console.log(`\n${ui.bold("Brightspace for your AI apps")} ${ui.dim("· setup takes about a minute")}`);

  ui.step(1, 4, "Your subscription");
  if (!(await ensureLicense(flags.key))) return 1;

  ui.step(2, 4, "Your school");
  const saved = readStoredConfig().baseUrl;
  let baseUrl: string | null = null;
  let input = flags.school ?? "";
  if (!input && saved) {
    if (await ui.confirm(`Use ${ui.bold(saved)}?`)) input = saved;
  }
  while (!baseUrl) {
    if (!input) {
      if (!ui.interactive) {
        ui.fail("No school given. Run again with --school <your Brightspace address>.");
        return 1;
      }
      ui.info(ui.dim("Open Brightspace in your browser and copy the link from the address bar."));
      ui.info(ui.dim("Examples: yourschool.brightspace.com, yourschool.desire2learn.com, or any link to a course page."));
      input = await ui.ask("Brightspace address:");
    }
    const result = await resolveSchool(input);
    if (result.ok) {
      baseUrl = result.baseUrl;
    } else {
      ui.fail(result.reason);
      if (!ui.interactive) return 1;
      input = "";
    }
  }
  writeStoredConfig({ baseUrl });
  ui.ok(`Brightspace found at ${ui.bold(baseUrl)}`);

  ui.step(3, 4, "Sign in");
  if (flags.skipLogin) {
    ui.info(ui.dim("Skipped. You'll be asked to sign in the first time your AI uses Brightspace."));
  } else {
    const signedIn = await signIn(baseUrl);
    if (!signedIn) return 1;
  }

  ui.step(4, 4, "Connect your AI apps");
  const found = detectClients().filter((c) => !flags.apps || flags.apps.includes(c.id));
  if (found.length === 0 && flags.apps) {
    ui.info(ui.dim("No apps selected. Add this to any MCP app's settings:"));
    printManualConfig();
    return 0;
  }
  if (found.length === 0) {
    ui.warn("No supported AI apps found (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code).");
    printManualConfig();
    return 0;
  }

  const chosen: ClientTarget[] = [];
  ui.info(`Found: ${found.map((c) => ui.bold(c.name)).join(", ")}`);
  if (found.length > 1 && (await ui.confirm("Connect all of them?"))) {
    chosen.push(...found);
  } else {
    for (const client of found) {
      if (found.length === 1 || (await ui.confirm(`Connect ${client.name}?`))) chosen.push(client);
    }
  }

  const connected: string[] = [];
  for (const client of chosen) {
    try {
      if (await connect(client)) connected.push(client.name);
    } catch (error) {
      ui.fail(`${client.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${ui.bold(ui.green("All set!"))}`);
  if (connected.length) {
    ui.info(`Connected: ${connected.join(", ")}.`);
    const needsRestart = connected.filter((n) => n !== "Claude Desktop");
    if (needsRestart.length) ui.info(ui.dim(`Restart ${needsRestart.join(", ")} (or reload its window) to load Brightspace.`));
  }
  ui.info(`Try asking: ${ui.cyan('"What should I work on right now?"')}`);
  await startAlerts();
  console.log();
  return 0;
}

async function ensureLicense(key: string | undefined): Promise<boolean> {
  if (!key && readLicense()?.active) {
    ui.ok("Subscription found on this computer.");
    return true;
  }
  while (!key) {
    if (!ui.interactive) {
      ui.fail("No key given. Start a 7-day free trial at brightspacemcp.com/pro and run again with --key <your key>.");
      return false;
    }
    ui.info(ui.dim("Start a 7-day free trial at brightspacemcp.com/pro to get your key."));
    key = (await ui.ask("Your key (starts with bmp_):")).trim();
  }
  return activateKey(key);
}

async function signIn(baseUrl: string): Promise<boolean> {
  ui.info("A browser window will open on your Brightspace sign-in page.");
  ui.info("Sign in the way you normally do (school account, text code, authenticator...).");
  ui.info(ui.dim("The window closes by itself once you're in. No password is saved by this tool."));
  if (ui.interactive) await ui.ask(ui.dim("Press Enter to open the browser..."));

  let downloadedBrowser = false;
  for (;;) {
    try {
      const { token, displayName } = await loginWithBrowser({
        baseUrl,
        mode: "interactive",
        onStatus: (message) => ui.info(ui.dim(message)),
      });
      await new TokenManager({ baseUrl }).setToken(token);
      ui.ok(displayName ? `Signed in as ${ui.bold(displayName)}` : "Signed in");
      return true;
    } catch (error) {
      if (error instanceof NoBrowserError) {
        if (!downloadedBrowser) {
          downloadedBrowser = true;
          ui.info("Chrome or Edge isn't installed, so setup is downloading a small browser just for signing in.");
          ui.info(ui.dim("One time only, about 150 MB."));
          if (await installChromium()) continue;
        }
        ui.fail(error.message);
        return false;
      }
      const message = error instanceof LoginError ? error.message : `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`;
      ui.fail(message);
      if (!(await ui.confirm("Try signing in again?"))) {
        ui.info(ui.dim("You can finish later with: npx brightspace-d2l-mcp login"));
        return false;
      }
    }
  }
}

async function connect(client: ClientTarget): Promise<boolean> {
  if (client.id === "claude-desktop") return connectClaudeDesktop(client);

  if (client.id === "claude-code") {
    // Claude Code rewrites ~/.claude.json while running; its own CLI is the safe way in.
    if (!addViaClaudeCli()) addToClient(client);
    allowToolsInClaudeCode();
    ui.ok("Claude Code connected (tools allowed without asking each time)");
    return true;
  }

  addToClient(client);
  ui.ok(`${client.name} connected`);
  return true;
}

async function connectClaudeDesktop(client: ClientTarget): Promise<boolean> {
  // Claude Desktop saves its config from memory while open, which would erase our entry.
  let relaunch: (() => void) | null = null;
  if (isClaudeDesktopRunning()) {
    if (await ui.confirm("Claude Desktop is open. Restart it now to add Brightspace?")) {
      relaunch = await quitClaudeDesktop();
    } else {
      ui.info("Quit Claude Desktop completely (tray icon → Quit), then press Enter.");
      await ui.ask(ui.dim("Press Enter when it's closed..."));
    }
    if (isClaudeDesktopRunning()) {
      ui.warn("Claude Desktop is still running, so it may undo this change. Quit it and run setup again if Brightspace doesn't appear.");
    }
  }
  addToClient(client);
  relaunch?.();
  ui.ok(`Claude Desktop connected${relaunch ? " and restarted" : ""}`);
  return true;
}

function addViaClaudeCli(): boolean {
  const entry = serverEntry();
  const json = JSON.stringify({ type: "stdio", command: entry.command, args: entry.args });
  try {
    const shell = process.platform === "win32";
    try {
      execFileSync("claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"], { stdio: "ignore", shell, timeout: 30_000 });
    } catch {
      // Not previously added.
    }
    execFileSync("claude", ["mcp", "add-json", SERVER_NAME, shell ? `"${json.replace(/"/g, '\\"')}"` : json, "--scope", "user"], {
      stdio: "ignore",
      shell,
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function printManualConfig(): void {
  const entry = serverEntry();
  ui.info("Add this to your AI app's MCP settings:");
  console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2).replace(/^/gm, "    "));
}
