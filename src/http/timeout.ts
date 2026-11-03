export function createRequestSignal(
  timeout?: number,
  signal?: AbortSignal,
): AbortSignal | undefined {
  if (timeout === undefined) {
    return signal;
  }

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new RangeError("Timeout must be a finite, non-negative number");
  }

  const timeoutSignal = AbortSignal.timeout(timeout);

  if (signal === undefined) {
    return timeoutSignal;
  }

  return AbortSignal.any([signal, timeoutSignal]);
}
