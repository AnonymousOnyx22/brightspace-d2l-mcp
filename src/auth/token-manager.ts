
import type { TokenData } from "../types/index.js";
import { SessionStore } from "./session-store.js";
import { mintAccessToken } from "./token-mint.js";
import { log } from "../utils/logger.js";
import { TokenRefreshError } from "../api/errors.js";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_TOKEN_TTL_SECONDS = 3600;

export interface TokenManagerOptions {
  sessionFile?: string;
  baseUrl?: string;
  tokenTtl?: number;
  mint?: typeof mintAccessToken;
  sessionStore?: Pick<SessionStore, "load" | "save" | "clear" | "saveIfCurrent" | "clearIfCurrent">;
}

export class TokenManager {
  private cachedToken: TokenData | null = null;
  private readonly sessionStore: NonNullable<TokenManagerOptions["sessionStore"]>;
  private readonly baseUrl?: string;
  private readonly tokenTtl: number;
  private readonly mint: typeof mintAccessToken;
  private mintInFlight: Promise<TokenData | null> | null = null;
  private rejectedAccessToken: string | null = null;

  constructor(options: TokenManagerOptions = {}) {
    this.sessionStore = options.sessionStore ?? new SessionStore(options.sessionFile);
    this.baseUrl = options.baseUrl ? new URL(options.baseUrl).origin : undefined;
    this.tokenTtl = options.tokenTtl ?? DEFAULT_TOKEN_TTL_SECONDS;
    this.mint = options.mint ?? mintAccessToken;
  }

  async getToken(rejectedAccessToken?: string): Promise<TokenData | null> {
    if (rejectedAccessToken) this.rejectedAccessToken = rejectedAccessToken;
    // Check memory cache first
    if (this.cachedToken && this.isUsable(this.cachedToken)) {
      log("DEBUG", "Returning cached token");
      return this.cachedToken;
    }

    // Try loading from disk
    const storedToken = await this.sessionStore.load();
    if (storedToken && this.isUsable(storedToken)) {
      log("DEBUG", "Loaded valid token from session store");
      this.cachedToken = storedToken;
      return storedToken;
    }

    const mintable = this.pickMintable(storedToken);
    if (mintable) {
      const minted = await this.mintFromSession(mintable);
      if (minted) return minted;
    }

    log("DEBUG", "No valid token available");
    return null;
  }

  private pickMintable(candidate: TokenData | null): TokenData | null {
    return this.baseUrl && candidate && this.matchesTenant(candidate) && candidate.cookieHeader && candidate.csrfToken ? candidate : null;
  }

  private async mintFromSession(stale: TokenData): Promise<TokenData | null> {
    if (this.mintInFlight) {
      log("DEBUG", "Joining the in-flight token mint");
      return this.mintInFlight;
    }

    const inFlight = this.runMint(stale).finally(() => {
      this.mintInFlight = null;
    });
    this.mintInFlight = inFlight;
    return inFlight;
  }

  private async runMint(stale: TokenData): Promise<TokenData | null> {
    log("DEBUG", "Trying to mint an access token from the session cookie");

    let result;
    try {
      result = await this.mint({
        baseUrl: this.baseUrl as string,
        cookieHeader: stale.cookieHeader as string,
        csrfToken: stale.csrfToken as string,
      });
    } catch (error) {
      throw new TokenRefreshError("token service request failed", error instanceof Error ? error : undefined);
    }

    // The auth CLI or another MCP process can finish a login while HTTP minting
    // is in flight. Its newer session wins over either result of this request.
    const current = await this.sessionStore.load();
    if (current && !this.sameToken(current, stale)) {
      this.cachedToken = current;
      if (this.isUsable(current)) return current;
      throw new TokenRefreshError("saved authentication changed during refresh");
    }

    if (result.ok) {
      const now = Date.now();
      const token: TokenData = {
        accessToken: result.accessToken,
        tenantOrigin: this.baseUrl,
        capturedAt: now,
        expiresAt: now + this.tokenTtl * 1000,
        source: "browser",
        cookieHeader: stale.cookieHeader,
        csrfToken: stale.csrfToken,
      };
      if (!await this.sessionStore.saveIfCurrent(token, stale)) return this.afterConcurrentChange();
      this.cachedToken = token;
      this.rejectedAccessToken = null;
      log("INFO", "Minted a fresh access token from the session cookie");
      return token;
    }

    if (result.reason === "sessionExpired") {
      log("INFO", "The session cookie has expired, a browser login is needed");
      if (!await this.sessionStore.clearIfCurrent(stale)) return this.afterConcurrentChange();
      this.cachedToken = null;
      return null;
    }

    throw new TokenRefreshError(result.detail ?? "unexpected token service response");
  }

  async setToken(token: TokenData): Promise<void> {
    await this.sessionStore.save(token);
    this.cachedToken = token;
    this.rejectedAccessToken = null;
    log("DEBUG", "Token cached and persisted");
  }

  async clearToken(): Promise<void> {
    this.cachedToken = null;
    await this.sessionStore.clear();
    log("DEBUG", "Token cleared from memory and disk");
  }

  private isUsable(token: TokenData): boolean {
    return this.matchesTenant(token) && token.accessToken !== this.rejectedAccessToken && this.isValid(token);
  }

  private matchesTenant(token: TokenData): boolean {
    return this.baseUrl === undefined || token.tenantOrigin === this.baseUrl;
  }

  private sameToken(a: TokenData, b: TokenData): boolean {
    return a.accessToken === b.accessToken && a.capturedAt === b.capturedAt &&
      a.cookieHeader === b.cookieHeader && a.csrfToken === b.csrfToken && a.tenantOrigin === b.tenantOrigin;
  }

  private async afterConcurrentChange(): Promise<TokenData | null> {
    this.cachedToken = await this.sessionStore.load();
    if (this.cachedToken && this.isUsable(this.cachedToken)) return this.cachedToken;
    throw new TokenRefreshError("saved authentication changed during refresh");
  }

  isValid(token: TokenData): boolean {
    const now = Date.now();
    const timeUntilExpiry = token.expiresAt - now;

    // Token must expire more than REFRESH_BUFFER_MS in the future
    const valid = timeUntilExpiry > REFRESH_BUFFER_MS;

    if (!valid) {
      log(
        "DEBUG",
        `Token invalid: expires in ${Math.round(timeUntilExpiry / 1000)}s (buffer: ${REFRESH_BUFFER_MS / 1000}s)`
      );
    }

    return valid;
  }

  async needsRefresh(): Promise<boolean> {
    const token = await this.getToken();
    return token === null;
  }
}
