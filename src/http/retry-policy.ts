const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const RETRYABLE_METHODS = new Set(["GET", "PUT", "DELETE"]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function isRetryableMethod(method: string): boolean {
  return RETRYABLE_METHODS.has(method.toUpperCase());
}
