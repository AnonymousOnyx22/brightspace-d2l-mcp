
import type { TokenData } from "../types/index.js";
import type { TokenManager } from "../auth/token-manager.js";
import type { RetryConfig } from "./retry.js";

// D2L API version information returned by /d2l/api/versions/
export interface ApiVersions {
  lp: string; // Learning Platform version (e.g., "1.56")
  le: string; // Learning Environment version (e.g., "1.91")
}

// Cache TTL configuration in milliseconds
export interface CacheTTLs {
  enrollments: number;
  courseContent: number;
  announcements: number;
  grades: number;
  assignments: number;
  roster: number;
  profile: number;
}

// Default TTL values per user decision
export const DEFAULT_CACHE_TTLS: CacheTTLs = {
  enrollments: 3_600_000,
  courseContent: 1_800_000,
  announcements: 300_000,
  grades: 120_000,
  assignments: 600_000,
  roster: 3_600_000,
  profile: 3_600_000,
};

// Token bucket rate limiter configuration
export interface RateLimitConfig {
  capacity: number; // max burst size (e.g., 10)
  refillRate: number; // tokens per second (e.g., 3)
}

// D2L API client constructor options
export interface D2LApiClientOptions {
  baseUrl: string;
  tokenManager: TokenManager; // from auth module
  cacheTTLs?: Partial<CacheTTLs>;
  rateLimitConfig?: RateLimitConfig;
  timeoutMs?: number; // default 30_000
  onAuthExpired?: () => Promise<boolean>;
  retry?: RetryConfig;
}

// Re-export TokenData from shared types for convenience
export type { TokenData };
