import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

export function packageVersion(): string {
  if (cached) return cached;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // build/utils/version.js -> package.json two levels up
    cached = (JSON.parse(readFileSync(resolve(here, "..", "..", "package.json"), "utf8")).version as string) ?? "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
