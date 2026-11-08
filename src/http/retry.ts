import { calculateBackoff } from "./backoff.js";
import { isRetryableMethod, isRetryableStatus } from "./retry-policy.js";
import { getAbortError } from "./timeout.js";

import type { HttpMethod, RetryOptions } from "./types.js";

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
};

const MAX_TIMER_DELAY = 2_147_483_647;

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

function wait(delay: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal));
      return;
    }

    let remaining = delay;
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      if (signal !== undefined) {
        reject(getAbortError(signal));
      }
    };

    const schedule = () => {
      const currentDelay = Math.min(remaining, MAX_TIMER_DELAY);
      timer = setTimeout(() => {
        remaining -= currentDelay;
        if (remaining > 0) {
          schedule();
          return;
        }
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, currentDelay);
    };

    signal?.addEventListener("abort", onAbort, {
      once: true,
    });
    schedule();
  });
}

function getRetryAfterDelay(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (value === null) return undefined;

  const trimmedValue = value.trim();
  if (trimmedValue === "") return undefined;

  const seconds = Number(trimmedValue);
  const milliseconds = seconds * 1_000;
  if (Number.isFinite(milliseconds) && seconds >= 0) return milliseconds;

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

  const effectiveMethod = init.method ?? method;
  if (!isRetryableMethod(effectiveMethod) || !isReplayableBody(init.body)) {
    return fetch(url, init);
  }

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (init.signal?.aborted) throw getAbortError(init.signal);
      if (error instanceof TypeError && attempt < config.maxRetries) {
        await wait(calculateBackoff(attempt, config.baseDelay, config.maxDelay), init.signal);
        continue;
      }
      throw error;
    }

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
