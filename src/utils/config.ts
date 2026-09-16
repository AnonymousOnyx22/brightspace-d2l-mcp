import * as fs from "node:fs";
import * as path from "node:path";
import type { AppConfig } from "../types/index.js";
import { writeFileAtomicSync } from "./atomic-write.js";
import { configPath } from "./paths.js";

export interface StoredConfig {
  baseUrl?: string;
  includeCourses?: number[];
  excludeCourses?: number[];
  activeOnly?: boolean;
  autoLogin?: boolean;
  ssoEntryUrl?: string;
  /** Access token for `serve --http`. */
  httpToken?: string;
}

export function readStoredConfig(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function writeStoredConfig(update: StoredConfig): StoredConfig {
  const next = { ...readStoredConfig(), ...update };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true, mode: 0o700 });
  writeFileAtomicSync(configPath(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

export function normalizeSchoolUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.username || url.password || !url.hostname.includes(".")) return null;
    url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

function parseIds(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

export function loadConfig(): AppConfig {
  const store = readStoredConfig();
  const rawUrl = process.env.D2L_BASE_URL || store.baseUrl;
  const baseUrl = rawUrl ? normalizeSchoolUrl(rawUrl) : null;
  const activeOnly = process.env.D2L_ACTIVE_ONLY !== undefined
    ? process.env.D2L_ACTIVE_ONLY !== "false"
    : store.activeOnly ?? true;
  const autoLogin = process.env.D2L_AUTO_LOGIN !== undefined
    ? process.env.D2L_AUTO_LOGIN !== "false"
    : store.autoLogin ?? true;

  return {
    baseUrl: baseUrl ?? "",
    tokenTtl: process.env.D2L_TOKEN_TTL ? parseInt(process.env.D2L_TOKEN_TTL, 10) : 3600,
    autoLogin,
    courseFilter: {
      includeCourseIds: parseIds(process.env.D2L_INCLUDE_COURSES) ?? store.includeCourses,
      excludeCourseIds: parseIds(process.env.D2L_EXCLUDE_COURSES) ?? store.excludeCourses,
      activeOnly,
    },
  };
}

export type { AppConfig };
