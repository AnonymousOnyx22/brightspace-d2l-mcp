import * as fs from "node:fs";
import * as path from "node:path";
import { dataDir } from "../utils/paths.js";
import { writeFileAtomicSync } from "../utils/atomic-write.js";

// Pro licenses are checked against brightspacemcp.com, which only asks Stripe
// whether the subscription behind the key is active. No Brightspace data or
// session ever leaves this computer.

export const LICENSE_API = () => process.env.BRIGHTSPACE_PRO_API || "https://brightspacemcp.com/api/license";
export const KEY_PATTERN = /^bmp_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}$/;

const RECHECK_MS = 12 * 3_600_000;
const OFFLINE_GRACE_MS = 7 * 24 * 3_600_000;

export interface LicenseRecord {
  key: string;
  active: boolean;
  status: string;
  checkedAt: number;
  lastActiveAt?: number;
  periodEnd?: number | null;
}

export const licensePath = () => path.join(dataDir(), "pro.json");

export function readLicense(): LicenseRecord | null {
  try {
    return JSON.parse(fs.readFileSync(licensePath(), "utf8")) as LicenseRecord;
  } catch {
    return null;
  }
}

export function writeLicense(record: LicenseRecord): void {
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  writeFileAtomicSync(licensePath(), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
}

export function deleteLicense(): void {
  fs.rmSync(licensePath(), { force: true });
}

export async function checkLicenseOnline(key: string, fetchImpl: typeof fetch = fetch): Promise<{ active: boolean; status: string; periodEnd: number | null }> {
  const res = await fetchImpl(LICENSE_API(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status >= 500) throw new Error(`License server error (${res.status}).`);
  const json = (await res.json().catch(() => ({}))) as { active?: boolean; status?: string; periodEnd?: number | null };
  return { active: json.active === true, status: json.status ?? (res.ok ? "unknown" : "invalid"), periodEnd: json.periodEnd ?? null };
}

/**
 * Whether Pro is usable right now. Rechecks online every 12 hours, and keeps
 * working for up to 7 days without internet after the last good check.
 */
export async function licenseIsActive(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  const record = readLicense();
  if (!record) return false;
  if (now - record.checkedAt < RECHECK_MS) return record.active;
  try {
    const result = await checkLicenseOnline(record.key, fetchImpl);
    writeLicense({ ...record, ...result, checkedAt: now, lastActiveAt: result.active ? now : record.lastActiveAt });
    return result.active;
  } catch {
    return Boolean(record.lastActiveAt && now - record.lastActiveAt < OFFLINE_GRACE_MS);
  }
}
