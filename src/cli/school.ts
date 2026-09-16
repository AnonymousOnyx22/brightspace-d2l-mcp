import { normalizeSchoolUrl } from "../utils/config.js";

export type SchoolCheck =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: string };

type Probe = { result: "yes" | "no" | "unreachable"; platform: string | null };

function otherPlatform(headers: Headers): string | null {
  if (headers.get("x-blackboard-product")) return "Blackboard";
  if (headers.get("x-canvas-meta") || headers.get("x-canvas-user-id") !== null) return "Canvas";
  if ([...headers.keys()].some((k) => k.startsWith("x-moodle"))) return "Moodle";
  return null;
}

// Brightspace lists its API versions publicly, which makes it easy to recognize.
async function probe(origin: string): Promise<Probe> {
  try {
    const response = await fetch(`${origin}/d2l/api/versions/`, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    const platform = otherPlatform(response.headers);
    if (!response.ok) return { result: "no", platform };
    const body = (await response.json()) as Array<{ ProductCode?: string }>;
    const isBrightspace = Array.isArray(body) && body.some((p) => p?.ProductCode === "lp");
    return { result: isBrightspace ? "yes" : "no", platform };
  } catch (error) {
    return { result: (error as Error)?.name === "SyntaxError" ? "no" : "unreachable", platform: null };
  }
}

const IDENTITY_PROVIDER_HOSTS = [
  "login.microsoftonline.com",
  "okta.com",
  "duosecurity.com",
  "accounts.google.com",
  "adfs",
  "sts.",
  "shibboleth",
  "idp.",
  "cas.",
];

export async function resolveSchool(input: string): Promise<SchoolCheck> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Nothing was entered." };

  // A short name like "yourschool" could be either of the hostnames D2L hands out.
  const candidates = /^[a-z0-9-]+$/i.test(trimmed)
    ? [`https://${trimmed}.brightspace.com`, `https://${trimmed}.desire2learn.com`]
    : [normalizeSchoolUrl(trimmed)].filter((u): u is string => !!u);

  if (candidates.length === 0) return { ok: false, reason: "That doesn't look like a web address." };

  let unreachable = false;
  let platform: string | null = null;
  for (const origin of candidates) {
    const probed = await probe(origin);
    if (probed.result === "yes") return { ok: true, baseUrl: origin };
    if (probed.result === "unreachable") unreachable = true;
    platform ??= probed.platform;
  }

  const host = new URL(candidates[0]).hostname;
  if (platform) {
    return { ok: false, reason: `${host} runs ${platform}, not Brightspace (D2L). This tool only works with Brightspace.` };
  }
  if (IDENTITY_PROVIDER_HOSTS.some((idp) => host.includes(idp))) {
    return {
      ok: false,
      reason: "That's your school's sign-in page, not Brightspace. Sign in first, then copy the address of your Brightspace home page.",
    };
  }
  return {
    ok: false,
    reason: unreachable
      ? `Couldn't reach ${host}. Check the address and your internet connection.`
      : `${host} isn't a Brightspace site. Open Brightspace in your browser and copy the address from the address bar.`,
  };
}
