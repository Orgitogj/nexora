import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("Timeout and cancellation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("allows requests to complete before the timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.get("/fast", { timeout: 1_000 })).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it("aborts requests when the timeout expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new Error("Aborted"));
            },
            { once: true },
          );
        }),
    );
    const client = createClient({
      baseUrl: "https://api.example.test",
      retry: { maxRetries: 0 },
    });

    const request = client.get("/slow", { timeout: 50 });
    const requestError = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(50);

    await requestError;
  });

  it("supports manual cancellation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new Error("Aborted"));
            },
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const client = createClient({
      baseUrl: "https://api.example.test",
      retry: { maxRetries: 0 },
    });

    const request = client.get("/cancel", { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("Cancelled by caller", "AbortError"));

    await expect(request).rejects.toMatchObject({
      name: "AbortError",
      message: "Cancelled by caller",
    });
  });

  it("distinguishes timeout errors from network errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new Error("Aborted"));
            },
            { once: true },
          );
        }),
    );
    const client = createClient({
      baseUrl: "https://api.example.test",
      retry: { maxRetries: 0 },
    });
    const timeoutRequest = client.get("/timeout", { timeout: 10 });
    const timeoutError = expect(timeoutRequest).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10);
    await timeoutError;

    vi.mocked(fetchMock).mockRejectedValueOnce(new TypeError("network down"));
    await expect(client.get("/network")).rejects.toMatchObject({
      name: "TypeError",
      message: "network down",
    });
  });

  it("cleans up after completion and rejects invalid timeout values", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient({ baseUrl: "https://api.example.test" });

    await client.get("/fast", { timeout: 60_000 });
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.get("/invalid", { timeout: -1 })).rejects.toThrow(RangeError);
  });
});
