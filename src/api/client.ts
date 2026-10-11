import type { D2LApiClientOptions, ApiVersions, CacheTTLs, TokenData } from "./types.js";
import { DEFAULT_CACHE_TTLS } from "./types.js";
import { TTLCache } from "./cache.js";
import { TokenBucket } from "./rate-limiter.js";
import { discoverVersions } from "./version-discovery.js";
import { ApiError, RateLimitError, NetworkError } from "./errors.js";
import { withRetry, isRetryableFailure, retryAfterMsFrom, type RetryConfig } from "./retry.js";
import { log } from "../utils/logger.js";
import { LOGIN_COMMAND } from "../utils/paths.js";
import { packageVersion } from "../utils/version.js";

function isExpiredSessionRedirect(body: string, baseUrl: string): boolean {
  const expiredTarget = (target: string): boolean => {
    try {
      const url = new URL(target.replace(/&amp;/gi, "&").replace(/\\\//g, "/"), baseUrl);
      return url.origin === new URL(baseUrl).origin && url.pathname === "/d2l/login" &&
        url.searchParams.get("sessionExpired") === "1";
    } catch {
      return false;
    }
  };
  for (const script of body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const redirect = /(?:(?:window|document)\s*\.\s*)?location\s*(?:\.\s*(?:replace|assign)\s*\(\s*|(?:\.\s*href\s*)?=\s*)(["'])(.*?)\1/g;
    for (const match of script[1].matchAll(redirect)) {
      if (expiredTarget(match[2])) return true;
    }
  }
  for (const meta of body.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map(
      [...meta[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1].toLowerCase(), match[3]]),
    );
    if (attributes.get("http-equiv")?.toLowerCase() !== "refresh") continue;
    const target = attributes.get("content")?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*(.*?)\s*$/i)?.[1];
    if (target && expiredTarget(target)) return true;
  }
  return false;
}

const LP_VERSION = "{lp}";
const LE_VERSION = "{le}";

export class D2LApiClient {
  private readonly baseUrl: string;
  private readonly tokenManager: D2LApiClientOptions["tokenManager"];
  private readonly cache: TTLCache;
  private readonly rateLimiter: TokenBucket;
  private readonly cacheTTLs: CacheTTLs;
  private readonly timeoutMs: number;
  private readonly onAuthExpired?: () => Promise<boolean>;
  private readonly retryConfig: RetryConfig;
  private versions: ApiVersions | null = null;
  private versionsInFlight: Promise<ApiVersions> | null = null;

  constructor(options: D2LApiClientOptions) {
    // HTTPS-only enforcement, on a parsed URL rather than a string prefix so
    // a malformed base cannot slip through as "not http".
    let parsedBase: URL;
    try {
      parsedBase = new URL(options.baseUrl);
    } catch {
      throw new Error(`Invalid D2L base URL: ${options.baseUrl}`);
    }
    if (parsedBase.protocol !== "https:") {
      throw new Error(
        "HTTPS is required for D2L API client. HTTP URLs are not allowed for security reasons.",
      );
    }

    // Strip trailing slash from baseUrl
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.tokenManager = options.tokenManager;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.onAuthExpired = options.onAuthExpired;
    this.retryConfig = options.retry ?? {};

    // Merge user-provided TTLs with defaults
    this.cacheTTLs = { ...DEFAULT_CACHE_TTLS, ...options.cacheTTLs };

    // Initialize cache and rate limiter
    this.cache = new TTLCache();
    const rateLimitConfig = options.rateLimitConfig ?? {
      capacity: 10,
      refillRate: 3,
    };
    this.rateLimiter = new TokenBucket(
      rateLimitConfig.capacity,
      rateLimitConfig.refillRate,
    );

    log("DEBUG", `D2LApiClient initialized for ${this.baseUrl}`);
  }

  async ensureVersions(): Promise<ApiVersions> {
    if (this.versions) return this.versions;

    if (!this.versionsInFlight) {
      const flow = discoverVersions(this.baseUrl, this.timeoutMs)
        .then(versions => {
          this.versions = versions;
          log("INFO", `D2L API versions discovered: LP ${versions.lp}, LE ${versions.le}`);
          return versions;
        })
        .finally(() => {
          if (this.versionsInFlight === flow) this.versionsInFlight = null;
        });
      this.versionsInFlight = flow;
    }

    return this.versionsInFlight;
  }

  async initialize(): Promise<void> {
    await this.ensureVersions();
  }

  get apiVersions(): ApiVersions {
    if (!this.versions) {
      throw new Error(
        "API versions have not been discovered yet. They are fetched on the first request.",
      );
    }
    return this.versions;
  }

  private async resolvePath(path: string): Promise<string> {
    if (!path.includes(LP_VERSION) && !path.includes(LE_VERSION)) return path;
    const { lp, le } = await this.ensureVersions();
    return path.split(LP_VERSION).join(lp).split(LE_VERSION).join(le);
  }

  async get<T>(path: string, options?: { ttl?: number }): Promise<T> {
    // Checked before the path is resolved, and keyed by the path as the caller
    // wrote it, so a cached read needs neither version discovery nor a token.
    if (options?.ttl && this.cache.has(path)) {
      log("DEBUG", `Cache hit: ${path}`);
      return this.cache.get(path) as T;
    }

    const resolved = await this.resolvePath(path);
    const data = await this.withAuthentication(resolved, token => this.makeRequest<T>(resolved, token));

    if (options?.ttl) {
      this.cache.set(path, data, options.ttl);
      log("DEBUG", `Cached response for ${path} (TTL: ${options.ttl}ms)`);
    }

    return data;
  }

  async getRaw(path: string): Promise<Response> {
    const resolved = await this.resolvePath(path);
    return this.withAuthentication(resolved, token => this.makeRawRequest(resolved, token));
  }

  private async withAuthentication<T>(path: string, request: (token: TokenData) => Promise<T>): Promise<T> {
    let token = await this.tokenManager.getToken();
    let authenticated = false;
    if (!token) {
      token = await this.tryAutoReauth(path);
      authenticated = true;
    }
    const send = (current: TokenData) => this.retrying(() => this.throttled(() => request(current)));
    try {
      return await send(token);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (authenticated) throw error;
    }

    const fresh = await this.tokenManager.getToken(token.accessToken);
    if (fresh && fresh.accessToken !== token.accessToken) {
      try {
        return await send(fresh);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
    }

    const loggedIn = await this.tryAutoReauth(path, fresh?.accessToken ?? token.accessToken);
    return send(loggedIn);
  }

  private async throttled<T>(fn: () => Promise<T>): Promise<T> {
    await this.rateLimiter.consume();
    return fn();
  }

  private retrying<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      ...this.retryConfig,
      shouldRetry: isRetryableFailure,
      retryAfterMs: retryAfterMsFrom,
    });
  }

  private async tryAutoReauth(path: string, rejectedAccessToken?: string): Promise<TokenData> {
    if (this.onAuthExpired) {
      log("INFO", "Attempting auto-reauthentication...");
      const success = await this.onAuthExpired();
      if (success) {
        const freshToken = await this.tokenManager.getToken(rejectedAccessToken);
        if (freshToken) {
          log("INFO", "Auto-reauthentication succeeded, retrying request");
          return freshToken;
        }
      }
      log("WARN", "Auto-reauthentication did not produce a valid token");
    }
    throw new ApiError(401, path, `Session expired. Please re-authenticate via ${LOGIN_COMMAND}.`);
  }

  private async makeRequest<T>(
    path: string,
    token: TokenData,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.buildAuthHeaders(token);

    try {
      log("DEBUG", `Requesting GET ${path}`);

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      // Preserve cookie material: a 401 only rejects this access token.
      if (response.status === 401) {
        throw new ApiError(401, path, "Brightspace rejected the access token.");
      }

      // Handle 429 rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        throw new RateLimitError(path, retryAfterSeconds);
      }

      // Handle 403 (common for past-semester courses)
      if (response.status === 403) {
        const responseText = await response.text();
        throw new ApiError(403, path, responseText);
      }

      // Handle other non-OK responses
      if (!response.ok) {
        const responseText = await response.text();
        throw new ApiError(response.status, path, responseText);
      }

      const responseBody = await response.text();

      let data: T;
      try {
        data = JSON.parse(responseBody) as T;
      } catch {
        // Only now consider the stub: a real payload that merely mentions the
        // marker still parses, so it can never be misread as a dead session.
        if (isExpiredSessionRedirect(responseBody, this.baseUrl)) {
          log("DEBUG", "Response carried the session-expired stub, treating it as a 401");
          throw new ApiError(
            401,
            path,
            `Session expired. Please re-authenticate via ${LOGIN_COMMAND}.`,
          );
        }
        throw new ApiError(
          response.status,
          path,
          `Expected JSON from ${path} but the body did not parse`,
        );
      }

      return data;
    } catch (error) {
      // Re-throw our own errors
      if (
        error instanceof ApiError ||
        error instanceof RateLimitError ||
        error instanceof NetworkError
      ) {
        throw error;
      }

      // Wrap network/fetch errors
      const message = error instanceof Error ? error.message : String(error);
      throw new NetworkError(
        `Request to ${path} failed: ${message}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async makeRawRequest(
    path: string,
    token: TokenData,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.buildAuthHeaders(token);

    try {
      log("DEBUG", `Requesting GET ${path} (raw)`);

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      // Preserve cookie material for the shared HTTP refresh path.
      if (response.status === 401) {
        throw new ApiError(401, path, "Brightspace rejected the access token.");
      }

      // Handle 429 rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        throw new RateLimitError(path, retryAfterSeconds);
      }

      // Handle 403 (common for past-semester courses or no access)
      if (response.status === 403) {
        const responseText = await response.text();
        throw new ApiError(403, path, responseText);
      }

      // Handle 404 (file not found)
      if (response.status === 404) {
        throw new ApiError(404, path, "File not found");
      }

      // Handle other non-OK responses
      if (!response.ok) {
        const responseText = await response.text();
        throw new ApiError(response.status, path, responseText);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.startsWith("text/html")) {
        const body = await response.text();
        if (isExpiredSessionRedirect(body, this.baseUrl)) {
          log("DEBUG", "File download answered with the session-expired stub, treating it as a 401");
          throw new ApiError(
            401,
            path,
            `Session expired. Please re-authenticate via ${LOGIN_COMMAND}.`,
          );
        }
        // A legitimate HTML page: hand back an equivalent response with the
        // body we already consumed.
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // Return raw response for caller to process
      return response;
    } catch (error) {
      // Re-throw our own errors
      if (
        error instanceof ApiError ||
        error instanceof RateLimitError ||
        error instanceof NetworkError
      ) {
        throw error;
      }

      // Wrap network/fetch errors
      const message = error instanceof Error ? error.message : String(error);
      throw new NetworkError(
        `Request to ${path} failed: ${message}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private buildAuthHeaders(token: TokenData): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent":
        `brightspace-d2l-mcp/${packageVersion()}`,
    };

    // Auto-detect cookie vs Bearer auth based on "cookie:" prefix
    if (token.accessToken.startsWith("cookie:")) {
      // Cookie-based auth: strip prefix and set Cookie header
      headers["Cookie"] = token.accessToken.substring(7);
      log("DEBUG", "Using cookie-based authentication");
    } else {
      // Bearer token auth
      headers["Authorization"] = `Bearer ${token.accessToken}`;
      log("DEBUG", "Using Bearer token authentication");
    }

    return headers;
  }

  lp(path: string): string {
    return `/d2l/api/lp/${LP_VERSION}${path}`;
  }

  le(orgUnitId: number, path: string): string {
    return `/d2l/api/le/${LE_VERSION}/${orgUnitId}${path}`;
  }

  leGlobal(path: string): string {
    return `/d2l/api/le/${LE_VERSION}${path}`;
  }

  clearCache(): void {
    this.cache.clear();
    log("DEBUG", "Cache cleared");
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
