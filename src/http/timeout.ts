export interface RequestSignal {
  signal: AbortSignal | undefined;
  dispose(): void;
}

const abortReasons = new WeakMap<AbortSignal, Error>();

function createNamedError(name: string, message: string): Error {
  if (typeof DOMException !== "undefined") return new DOMException(message, name);

  const error = new Error(message);
  error.name = name;
  return error;
}

export function getAbortError(signal: AbortSignal | null): Error {
  const reason: unknown = signal === null ? undefined : (abortReasons.get(signal) ?? signal.reason);
  return reason instanceof Error
    ? reason
    : createNamedError("AbortError", "The request was aborted");
}

export function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw getAbortError(signal);
}

export function createRequestSignal(timeout?: number, signal?: AbortSignal): RequestSignal {
  if (timeout === undefined) {
    return { signal, dispose: () => undefined };
  }

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new RangeError("Timeout must be a finite, non-negative number");
  }

  const controller = new AbortController();
  const timeoutError = createNamedError("TimeoutError", "The operation timed out");
  const timer = setTimeout(() => abortWithReason(controller, timeoutError), timeout);
  let onAbort: (() => void) | undefined;

  if (signal !== undefined) {
    onAbort = () => abortWithReason(controller, getAbortError(signal));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    },
  };
}

function abortWithReason(controller: AbortController, reason: Error): void {
  if (controller.signal.aborted) return;

  abortReasons.set(controller.signal, reason);
  controller.abort(reason);
}
