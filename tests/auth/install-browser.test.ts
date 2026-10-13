import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { installChromium, playwrightCliPath } from "../../src/auth/install-browser.js";

describe("installChromium", () => {
  it("runs the bundled playwright-core CLI with this Node", async () => {
    expect(fs.existsSync(playwrightCliPath())).toBe(true);
    const calls: unknown[][] = [];
    const fake = ((...args: unknown[]) => {
      calls.push(args);
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", 0));
      return child;
    }) as never;
    await expect(installChromium(fake)).resolves.toBe(true);
    expect(calls[0][0]).toBe(process.execPath);
    expect(calls[0][1]).toEqual([playwrightCliPath(), "install", "chromium"]);
  });

  it("reports failure", async () => {
    const fake = (() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", 1));
      return child;
    }) as never;
    await expect(installChromium(fake)).resolves.toBe(false);
  });
});
