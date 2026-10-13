import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, spawn } from "node:child_process";
import { PACKAGE_NAME, dataDir } from "../utils/paths.js";

// Starts the Pro agent when the student logs in, using what each OS has built
// in: the Startup folder on Windows, a LaunchAgent on macOS and an XDG
// autostart entry on Linux. It always runs the latest published version.

const LABEL = "com.brightspacemcp.pro";
const AGENT_ARGS = ["-y", `${PACKAGE_NAME}@latest`, "pro", "agent"];

export function npxPath(platform: NodeJS.Platform = process.platform, execPath = process.execPath): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(p.dirname(execPath), platform === "win32" ? "npx.cmd" : "npx");
}

export interface AutostartEntry {
  file: string;
  contents: string;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function autostartEntry(platform: NodeJS.Platform = process.platform, home = os.homedir(), execPath = process.execPath): AutostartEntry | null {
  const npx = npxPath(platform, execPath);
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.win32.join(home, "AppData", "Roaming");
    const command = [`"${npx}"`, ...AGENT_ARGS].join(" ").replace(/"/g, '""');
    return {
      file: path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Brightspace MCP Pro.vbs"),
      contents: `' Starts Brightspace MCP Pro alerts in the background when you log in.\r\nCreateObject("WScript.Shell").Run "${command}", 0, False\r\n`,
    };
  }
  if (platform === "darwin") {
    const args = [npx, ...AGENT_ARGS].map((a) => `    <string>${xml(a)}</string>`).join("\n");
    return {
      file: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(path.dirname(execPath))}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>${xml(path.join(dataDir(), "pro-agent.log"))}</string>
</dict>
</plist>
`,
    };
  }
  if (platform === "linux") {
    const exec = [npx, ...AGENT_ARGS].map((a) => (/[\s"\\]/.test(a) ? `"${a.replace(/(["\\`$])/g, "\\$1")}"` : a)).join(" ");
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return {
      file: path.join(configHome, "autostart", "brightspace-mcp-pro.desktop"),
      contents: `[Desktop Entry]\nType=Application\nName=Brightspace MCP Pro\nComment=Deadline, grade and daily alerts for Brightspace\nExec=${exec}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`,
    };
  }
  return null;
}

export function installAutostart(): string | null {
  const entry = autostartEntry();
  if (!entry) return null;
  fs.mkdirSync(path.dirname(entry.file), { recursive: true });
  fs.writeFileSync(entry.file, entry.contents);
  return entry.file;
}

export function removeAutostart(): void {
  const entry = autostartEntry();
  if (!entry) return;
  if (process.platform === "darwin") execFile("launchctl", ["unload", entry.file], () => {});
  fs.rmSync(entry.file, { force: true });
}

export const pidPath = () => path.join(dataDir(), "pro-agent.pid");

export function runningAgentPid(): number | null {
  try {
    const pid = Number(fs.readFileSync(pidPath(), "utf8"));
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Starts the agent now, detached, using this same installed copy. */
export function startAgentNow(): void {
  if (runningAgentPid()) return;
  const script = process.argv[1];
  const child = spawn(process.execPath, [script, "pro", "agent"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

export function stopAgent(): boolean {
  const pid = runningAgentPid();
  if (!pid) return false;
  try {
    process.kill(pid);
  } catch {
    return false;
  }
  fs.rmSync(pidPath(), { force: true });
  return true;
}
