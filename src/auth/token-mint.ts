
import { packageVersion } from "../utils/version.js";
import { log } from "../utils/logger.js";

const EXPIRED_MARKER = "/d2l/login?sessionExpired=1";

const USER_AGENT =
  `brightspace-d2l-mcp/${packageVersion()}`;

const DEFAULT_TIMEOUT_MS = 15000;

export interface MintOptions {
  baseUrl: string;
  cookieHeader: string;
  csrfToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type MintResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "sessionExpired" | "transport"; detail?: string };

const transport = (detail: string): MintResult => ({
  ok: false,
  reason: "transport",
  detail,
});

function expiredRedirect(location: string | null, tokenUrl: string): boolean {
  if (!location) return false;
  try {
    const target = new URL(location, tokenUrl);
    return target.origin === new URL(tokenUrl).origin &&
      target.pathname === "/d2l/login" && target.searchParams.get("sessionExpired") === "1";
  } catch {
    return false;
  }
}

export async function mintAccessToken({
  baseUrl,
  cookieHeader,
  csrfToken,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: MintOptions): Promise<MintResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/d2l/lp/auth/oauth2/token`;

  let status: number;
  let body: string;
  let location: string | null;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader,
        "x-csrf-token": csrfToken,
        "User-Agent": USER_AGENT,
      },
      body: "scope=*:*:*",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    status = response.status;
    body = await response.text();
    location = response.headers?.get("location") ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return transport(message);
  }

  if (status >= 500 || status === 429) return transport(`HTTP ${status}`);

  let payload: { access_token?: unknown } | null = null;
  try {
    payload = JSON.parse(body) as { access_token?: unknown } | null;
  } catch {
    // The known expired-session response is an HTML login redirect.
  }

  if (status === 401 || (!payload && body.includes(EXPIRED_MARKER)) ||
      expiredRedirect(location, url)) {
    log("DEBUG", "The token mint answered with the session-expired stub");
    return { ok: false, reason: "sessionExpired" };
  }

  if (status < 200 || status >= 300) {
    return transport(`HTTP ${status}`);
  }

  if (!payload) {
    return transport("the token mint returned an unparseable body");
  }

  const accessToken = payload.access_token;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return transport("the token mint returned no access_token");
  }

  return { ok: true, accessToken };
}
