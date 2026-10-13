import * as path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// When neither Chrome nor Edge is installed (common on Macs that only use
// Safari), setup downloads Playwright's own Chromium, used only for signing in.
// It matches the bundled playwright-core version, so launching it just works.

export function playwrightCliPath(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
}

export function installChromium(run: typeof spawn = spawn): Promise<boolean> {
  return new Promise((resolve) => {
    const child = run(process.execPath, [playwrightCliPath(), "install", "chromium"], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
