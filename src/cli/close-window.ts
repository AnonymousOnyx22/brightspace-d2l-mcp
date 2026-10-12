import { execFile, spawn } from "node:child_process";
import * as ui from "./ui.js";

const SHELLS = new Set(["cmd.exe", "powershell.exe", "pwsh.exe"]);

export interface ProcessInfo {
  ppid: number;
  name: string;
}

/**
 * The outermost shell above `start`, which owns the console window.
 * Walks past the cmd.exe /c wrappers that npx.cmd adds, and stops at the first non-shell
 * above it (explorer.exe, WindowsTerminal.exe, an IDE...).
 */
export function outermostShell(processes: Map<number, ProcessInfo>, start: number): number | null {
  let found: number | null = null;
  const seen = new Set<number>();
  for (let pid = start; processes.has(pid) && !seen.has(pid); pid = processes.get(pid)!.ppid) {
    seen.add(pid);
    const name = processes.get(pid)!.name.toLowerCase();
    if (SHELLS.has(name)) found = pid;
    else if (found !== null) break;
  }
  return found;
}

function windowsProcesses(): Promise<Map<number, ProcessInfo>> {
  const script = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)\" }";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15_000, windowsHide: true }, (error, stdout) => {
      const map = new Map<number, ProcessInfo>();
      if (!error) {
        for (const line of stdout.split(/\r?\n/)) {
          const [pid, ppid, name] = line.split("\t");
          if (pid && ppid && name) map.set(Number(pid), { ppid: Number(ppid), name: name.trim() });
        }
      }
      resolve(map);
    });
  });
}

/** Whether setup should offer to close the window: an interactive Windows console that isn't an editor's built-in terminal. */
export function canCloseWindow(): boolean {
  return process.platform === "win32" && ui.interactive && process.env.TERM_PROGRAM !== "vscode" && !process.env.BRIGHTSPACE_KEEP_OPEN;
}

/**
 * Counts down, then closes the console window setup is running in.
 * Enter closes it at once; typing k (keep) leaves it open.
 */
export async function closeWindowAfterCountdown(seconds = 10): Promise<void> {
  const shellPromise = windowsProcesses().then((processes) => outermostShell(processes, process.pid));
  const answer = await ui.askWithTimeout(
    ui.dim(`This window closes in ${seconds} seconds. Press Enter to close it now, or type k and Enter to keep it open.`),
    seconds * 1000,
  );
  if (answer?.toLowerCase().startsWith("k")) return;

  const shell = await shellPromise;
  if (shell === null) return;
  // taskkill /T ends the shell and everything under it, this process included, which closes the window.
  spawn("taskkill", ["/PID", String(shell), "/T", "/F"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
