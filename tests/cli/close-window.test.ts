import { describe, expect, it } from "vitest";
import { outermostShell, type ProcessInfo } from "../../src/cli/close-window.js";

const tree = (rows: [number, number, string][]) => new Map<number, ProcessInfo>(rows.map(([pid, ppid, name]) => [pid, { ppid, name }]));

describe("outermostShell", () => {
  it("finds the cmd window that npx was typed into", () => {
    const processes = tree([
      [1, 0, "explorer.exe"],
      [10, 1, "cmd.exe"],
      [20, 10, "node.exe"],
      [30, 20, "node.exe"],
    ]);
    expect(outermostShell(processes, 30)).toBe(10);
  });

  it("walks past the cmd.exe /c wrapper PowerShell adds for npx.cmd", () => {
    const processes = tree([
      [1, 0, "WindowsTerminal.exe"],
      [10, 1, "powershell.exe"],
      [15, 10, "cmd.exe"],
      [20, 15, "node.exe"],
      [30, 20, "node.exe"],
    ]);
    expect(outermostShell(processes, 30)).toBe(10);
  });

  it("returns null when there is no shell above", () => {
    expect(outermostShell(tree([[1, 0, "Code.exe"], [30, 1, "node.exe"]]), 30)).toBeNull();
  });

  it("stops on a parent loop", () => {
    expect(outermostShell(tree([[10, 20, "cmd.exe"], [20, 10, "cmd.exe"]]), 10)).toBe(20);
  });
});
