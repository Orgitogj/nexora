import { calculateBackoff } from "./backoff.js";
import { isRetryableMethod, isRetryableStatus } from "./retry-policy.js";

import type { HttpMethod, RetryOptions } from "./types.js";

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
};

function resolveRetryOptions(options?: RetryOptions) {
  const resolved = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  if (
    !Number.isInteger(resolved.maxRetries) ||
    resolved.maxRetries < 0 ||
    !Number.isFinite(resolved.baseDelay) ||
    resolved.baseDelay < 0 ||
    !Number.isFinite(resolved.maxDelay) ||
    resolved.maxDelay < 0
  ) {
    throw new RangeError("Invalid retry configuration");
  }

  return resolved;
}

function getAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;

  if (reason instanceof Error) {
    return reason;
  }

  return new DOMException("The request was aborted", "AbortError");
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      if (signal !== undefined) {
        reject(getAbortError(signal));
      }
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);

    signal?.addEventListener("abort", onAbort, {
      once: true,
    });
  });
}

function getRetryAfterDelay(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (value === null) return undefined;

  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  return body === null || body === undefined || typeof body !== "object" || !("getReader" in body);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  method: HttpMethod,
  options?: RetryOptions,
): Promise<Response> {
  const config = resolveRetryOptions(options);

  if (!isRetryableMethod(method) || !isReplayableBody(init.body)) {
    return fetch(url, init);
  }

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const response = await fetch(url, init);

    if (response.ok || !isRetryableStatus(response.status) || attempt === config.maxRetries) {
      return response;
    }

    await response.body?.cancel();

    const delay =
      getRetryAfterDelay(response) ?? calculateBackoff(attempt, config.baseDelay, config.maxDelay);

    await wait(delay, init.signal ?? undefined);
  }

  throw new Error("Retry attempts exhausted");
}
