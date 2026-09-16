import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, SERVER_NAME } from "../utils/paths.js";

export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClientTarget {
  id: string;
  name: string;
  /** Config files to write (Claude Desktop can have two on Windows). */
  files: string[];
  format: "json" | "toml";
  /** Where the server map lives inside the file, e.g. ["mcpServers"]. */
  keyPath: string[];
  /** Turns the standard entry into this app's shape. */
  shape?: (entry: ServerEntry) => unknown;
  /** Apps that rewrite their own config while running must be closed first. */
  mustBeClosed?: boolean;
}

export const APP_IDS = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "vscode",
  "windsurf",
  "codex",
  "gemini-cli",
  "cline",
  "roo-code",
  "opencode",
  "zed",
  "lm-studio",
  "kiro",
] as const;

const home = os.homedir();
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

const exists = (p: string) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * How AI apps should launch this server: via npx from a published install so it
 * stays up to date, or the exact file from a local checkout.
 */
export function serverEntry(): ServerEntry {
  const entryFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
  const fromNpx = /[\\/]_npx[\\/]/.test(entryFile) || process.env.BRIGHTSPACE_MCP_USE_NPX === "1";
  if (!fromNpx) return { command: process.execPath, args: [entryFile] };
  return isWindows
    ? { command: "cmd", args: ["/c", "npx", "-y", `${PACKAGE_NAME}@latest`] }
    : { command: "npx", args: ["-y", `${PACKAGE_NAME}@latest`] };
}

const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");

/** Per-OS application support directory (where Electron apps keep settings). */
function appSupport(name: string): string {
  if (isWindows) return path.join(appData, name);
  if (isMac) return path.join(home, "Library", "Application Support", name);
  return path.join(xdgConfig, name);
}

function claudeDesktopFiles(): string[] {
  const files: string[] = [];
  const classic = appSupport("Claude");
  if (exists(classic)) files.push(path.join(classic, "claude_desktop_config.json"));
  if (isWindows) {
    // The Microsoft Store build is sandboxed and reads its own copy.
    try {
      for (const dir of fs.readdirSync(path.join(localAppData, "Packages"))) {
        if (!dir.startsWith("Claude_")) continue;
        const roaming = path.join(localAppData, "Packages", dir, "LocalCache", "Roaming", "Claude");
        if (exists(roaming)) files.push(path.join(roaming, "claude_desktop_config.json"));
      }
    } catch {
      // No Store apps.
    }
  }
  return files;
}

/** VS Code extension settings, for VS Code and its forks. */
function extensionSettingsFiles(extensionId: string, file: string): string[] {
  return ["Code", "Cursor", "Windsurf", "VSCodium"]
    .map((editor) => path.join(appSupport(editor), "User", "globalStorage", extensionId, "settings"))
    .filter(exists)
    .map((dir) => path.join(dir, file));
}

/** Every supported client found on this machine. */
export function detectClients(): ClientTarget[] {
  const found: ClientTarget[] = [];
  const add = (target: ClientTarget, present: boolean) => {
    if (present && target.files.length) found.push(target);
  };

  add({ id: "claude-desktop", name: "Claude Desktop", files: claudeDesktopFiles(), format: "json", keyPath: ["mcpServers"], mustBeClosed: true }, true);

  add({
    id: "claude-code",
    name: "Claude Code",
    files: [path.join(home, ".claude.json")],
    format: "json",
    keyPath: ["mcpServers"],
    shape: (e) => ({ type: "stdio", ...e }),
  }, exists(path.join(home, ".claude.json")) || exists(path.join(home, ".claude")));

  add({ id: "cursor", name: "Cursor", files: [path.join(home, ".cursor", "mcp.json")], format: "json", keyPath: ["mcpServers"] }, exists(path.join(home, ".cursor")));

  add({
    id: "vscode",
    name: "VS Code (Copilot)",
    files: [path.join(appSupport("Code"), "User", "mcp.json")],
    format: "json",
    keyPath: ["servers"],
    shape: (e) => ({ type: "stdio", ...e }),
  }, exists(path.join(appSupport("Code"), "User")));

  add({
    id: "windsurf",
    name: "Windsurf",
    files: [path.join(home, ".codeium", "windsurf", "mcp_config.json")],
    format: "json",
    keyPath: ["mcpServers"],
  }, exists(path.join(home, ".codeium", "windsurf")));

  add({
    id: "codex",
    name: "OpenAI Codex",
    files: [path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "config.toml")],
    format: "toml",
    keyPath: ["mcp_servers"],
  }, exists(process.env.CODEX_HOME ?? path.join(home, ".codex")));

  add({ id: "gemini-cli", name: "Gemini CLI", files: [path.join(home, ".gemini", "settings.json")], format: "json", keyPath: ["mcpServers"] }, exists(path.join(home, ".gemini")));

  add({
    id: "cline",
    name: "Cline",
    files: extensionSettingsFiles("saoudrizwan.claude-dev", "cline_mcp_settings.json"),
    format: "json",
    keyPath: ["mcpServers"],
  }, true);

  add({
    id: "roo-code",
    name: "Roo Code",
    files: extensionSettingsFiles("rooveterinaryinc.roo-cline", "mcp_settings.json"),
    format: "json",
    keyPath: ["mcpServers"],
  }, true);

  add({
    id: "opencode",
    name: "OpenCode",
    files: [path.join(xdgConfig, "opencode", "opencode.json")],
    format: "json",
    keyPath: ["mcp"],
    shape: (e) => ({ type: "local", command: [e.command, ...e.args], enabled: true }),
  }, exists(path.join(xdgConfig, "opencode")));

  add({
    id: "zed",
    name: "Zed",
    files: [path.join(isMac || !isWindows ? path.join(xdgConfig, "zed") : path.join(appData, "Zed"), "settings.json")],
    format: "json",
    keyPath: ["context_servers"],
    shape: (e) => ({ source: "custom", ...e }),
  }, exists(isMac || !isWindows ? path.join(xdgConfig, "zed") : path.join(appData, "Zed")));

  add({ id: "lm-studio", name: "LM Studio", files: [path.join(home, ".lmstudio", "mcp.json")], format: "json", keyPath: ["mcpServers"] }, exists(path.join(home, ".lmstudio")));

  add({ id: "kiro", name: "Kiro", files: [path.join(home, ".kiro", "settings", "mcp.json")], format: "json", keyPath: ["mcpServers"] }, exists(path.join(home, ".kiro")));

  return found;
}

function readJson(file: string): Record<string, unknown> {
  if (!exists(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${file} has comments or isn't plain JSON, so it wasn't changed. Add the server by hand (run \`npx ${PACKAGE_NAME} config\`).`);
  }
}

function backupOnce(file: string): void {
  if (exists(file) && !exists(`${file}.bak`)) fs.copyFileSync(file, `${file}.bak`);
}

function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backupOnce(file);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function writeJson(file: string, data: Record<string, unknown>): void {
  writeText(file, JSON.stringify(data, null, 2) + "\n");
}

function serverMap(config: Record<string, unknown>, keyPath: string[], create: boolean): Record<string, unknown> | undefined {
  let node: Record<string, unknown> = config;
  for (const key of keyPath) {
    if (typeof node[key] !== "object" || node[key] === null) {
      if (!create) return undefined;
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  return node;
}

// Codex keeps MCP servers in TOML tables: [mcp_servers.<name>]
const tomlString = (s: string) => JSON.stringify(s);

function tomlBlock(entry: ServerEntry): string {
  const lines = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
  ];
  if (entry.env && Object.keys(entry.env).length) {
    lines.push(`env = { ${Object.entries(entry.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }`);
  }
  return lines.join("\n") + "\n";
}

function withoutTomlBlock(text: string): { text: string; removed: boolean } {
  const header = new RegExp(`^\\[mcp_servers\\.(?:${SERVER_NAME}|"${SERVER_NAME}")\\]\\s*$`, "m");
  const match = header.exec(text);
  if (!match) return { text, removed: false };
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/^\s*\[/m);
  const end = next === -1 ? text.length : match.index + match[0].length + next;
  return { text: (text.slice(0, match.index) + text.slice(end)).replace(/\n{3,}/g, "\n\n"), removed: true };
}

export function addToClient(client: ClientTarget, entry: ServerEntry = serverEntry()): void {
  for (const file of client.files) {
    if (client.format === "toml") {
      const current = exists(file) ? withoutTomlBlock(fs.readFileSync(file, "utf8")).text.trimEnd() : "";
      writeText(file, `${current ? `${current}\n\n` : ""}${tomlBlock(entry)}`);
      continue;
    }
    const config = readJson(file);
    serverMap(config, client.keyPath, true)![SERVER_NAME] = client.shape ? client.shape(entry) : entry;
    writeJson(file, config);
  }
}

export function removeFromClient(client: ClientTarget): boolean {
  let removed = false;
  for (const file of client.files) {
    if (!exists(file)) continue;
    if (client.format === "toml") {
      const result = withoutTomlBlock(fs.readFileSync(file, "utf8"));
      if (result.removed) {
        writeText(file, result.text);
        removed = true;
      }
      continue;
    }
    const config = readJson(file);
    const servers = serverMap(config, client.keyPath, false);
    if (servers && SERVER_NAME in servers) {
      delete servers[SERVER_NAME];
      writeJson(file, config);
      removed = true;
    }
  }
  return removed;
}

export function isConfiguredIn(client: ClientTarget): boolean {
  return client.files.some((file) => {
    try {
      if (client.format === "toml") return exists(file) && withoutTomlBlock(fs.readFileSync(file, "utf8")).removed;
      return SERVER_NAME in (serverMap(readJson(file), client.keyPath, false) ?? {});
    } catch {
      return false;
    }
  });
}

/** Lets Claude Code use every Brightspace tool without asking each time. */
export function allowToolsInClaudeCode(): void {
  const file = path.join(home, ".claude", "settings.json");
  const settings = readJson(file);
  const permissions = (settings.permissions as { allow?: string[] } | undefined) ?? {};
  const rule = `mcp__${SERVER_NAME}`;
  if (permissions.allow?.includes(rule)) return;
  permissions.allow = [...(permissions.allow ?? []), rule];
  settings.permissions = permissions;
  writeJson(file, settings);
}

interface DesktopProcess {
  pid: number;
  exe: string;
}

function desktopProcesses(): DesktopProcess[] {
  try {
    if (isWindows) {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command",
          "Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like '*\\WindowsApps\\Claude_*' -or $_.Path -like '*\\AnthropicClaude\\*') } | ForEach-Object { \"$($_.Id)|$($_.Path)\" }"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 },
      );
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [pid, exe] = line.split("|");
        return { pid: Number(pid), exe };
      });
    }
    if (isMac) {
      const out = execFileSync("pgrep", ["-x", "Claude"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return out.split("\n").filter(Boolean).map((pid) => ({ pid: Number(pid), exe: "/Applications/Claude.app" }));
    }
  } catch {
    // Not running.
  }
  return [];
}

export function isClaudeDesktopRunning(): boolean {
  return desktopProcesses().length > 0;
}

/** Quits Claude Desktop. Returns a function that starts it again. */
export async function quitClaudeDesktop(): Promise<() => void> {
  const running = desktopProcesses();
  const storeExe = running.find((p) => p.exe.includes("\\WindowsApps\\Claude_"))?.exe;
  const classicExe = running.find((p) => p.exe.includes("AnthropicClaude"))?.exe;

  if (isMac) {
    try {
      execFileSync("osascript", ["-e", 'quit app "Claude"'], { stdio: "ignore", timeout: 15_000 });
    } catch {
      // Checked below.
    }
  } else {
    for (const p of running) {
      try {
        process.kill(p.pid);
      } catch {
        // Already gone.
      }
    }
  }

  for (let i = 0; i < 30 && isClaudeDesktopRunning(); i++) await new Promise((r) => setTimeout(r, 500));

  return () => {
    const detached = { detached: true, stdio: "ignore" as const };
    if (isMac) {
      spawn("open", ["-a", "Claude"], detached).unref();
    } else if (storeExe) {
      const family = storeExe.match(/WindowsApps\\(Claude)_[^_\\]+_[^_\\]+__([a-z0-9]+)/i);
      spawn("explorer.exe", [family ? `shell:AppsFolder\\${family[1]}_${family[2]}!Claude` : storeExe], detached).unref();
    } else if (classicExe) {
      spawn(classicExe, [], detached).unref();
    }
  };
}
