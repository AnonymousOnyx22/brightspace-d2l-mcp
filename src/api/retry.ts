
import { ApiError, NetworkError, RateLimitError } from "./errors.js";


export interface RetryConfig {
  maxAttempts?: number;
  initialMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
}

export interface RetryOptions extends RetryConfig {
  shouldRetry: (error: unknown) => boolean;
  retryAfterMs?: (error: unknown) => number | undefined;
}

const JITTER_FRACTION = 0.3;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxAttempts = 3,
    initialMs = 250,
    maxMs = 5000,
    sleep = defaultSleep,
    jitter = Math.random,
    shouldRetry,
    retryAfterMs,
  } = options;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;

      const requested = retryAfterMs?.(error);
      let delay: number;
      if (requested !== undefined) {
        delay = requested;
      } else {
        const base = Math.min(initialMs * 2 ** (attempt - 1), maxMs);
        delay = Math.round(base + base * JITTER_FRACTION * jitter());
      }
      await sleep(delay);
    }
  }
}

export function isRetryableFailure(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof ApiError) return error.status >= 500 && error.status <= 599;
  return error instanceof NetworkError;
}

export function retryAfterMsFrom(error: unknown): number | undefined {
  if (error instanceof RateLimitError && typeof error.retryAfter === "number" && error.retryAfter > 0) {
    return error.retryAfter * 1000;
  }
  return undefined;
}
