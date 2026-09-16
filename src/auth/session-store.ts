import * as fs from "node:fs";
import * as path from "node:path";
import type { TokenData } from "../types/index.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { sessionPath } from "../utils/paths.js";
import { log } from "../utils/logger.js";

export class SessionStore {
  constructor(private readonly file: string = sessionPath()) {}

  async load(): Promise<TokenData | null> {
    try {
      const data = JSON.parse(await fs.promises.readFile(this.file, "utf8")) as TokenData;
      return typeof data?.accessToken === "string" ? data : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") log("WARN", "Ignoring unreadable session file", error);
      return null;
    }
  }

  async save(token: TokenData): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.file, JSON.stringify(token), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await fs.promises.rm(this.file, { force: true });
  }

  async saveIfCurrent(token: TokenData, expected: TokenData): Promise<boolean> {
    if (!same(await this.load(), expected)) return false;
    await this.save(token);
    return true;
  }

  async clearIfCurrent(expected: TokenData): Promise<boolean> {
    if (!same(await this.load(), expected)) return false;
    await this.clear();
    return true;
  }
}

function same(a: TokenData | null, b: TokenData): boolean {
  return !!a && a.accessToken === b.accessToken && a.capturedAt === b.capturedAt &&
    a.cookieHeader === b.cookieHeader && a.csrfToken === b.csrfToken && a.tenantOrigin === b.tenantOrigin;
}
