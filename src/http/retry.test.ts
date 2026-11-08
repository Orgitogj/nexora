import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./retry.js";

describe("Retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([408, 429, 500, 502, 503, 504])("retries status %i", async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      fetchWithRetry("https://api.example.test", {}, "GET", { maxRetries: 1, baseDelay: 0 }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404])("does not retry ordinary status %i", async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status }));

    await expect(
      fetchWithRetry("https://api.example.test", {}, "GET", { maxRetries: 3, baseDelay: 0 }),
    ).resolves.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("respects the maximum retry count", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 503 }));

    await fetchWithRetry("https://api.example.test", {}, "GET", { maxRetries: 2, baseDelay: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after a successful response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchWithRetry("https://api.example.test", {}, "GET", { maxRetries: 4, baseDelay: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff capped by maxDelay", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const request = fetchWithRetry("https://api.example.test", {}, "GET", {
      maxRetries: 2,
      baseDelay: 100,
      maxDelay: 150,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(149);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits for the Retry-After header when provided", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const request = fetchWithRetry("https://api.example.test", {}, "GET", {
      maxRetries: 1,
      baseDelay: 0,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports HTTP-date Retry-After values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "Sat, 07 Nov 2026 12:00:02 GMT" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const request = fetchWithRetry("https://api.example.test", {}, "GET", {
      maxRetries: 1,
      baseDelay: 0,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits through timer-sized chunks for a long Retry-After", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "2147484" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const request = fetchWithRetry("https://api.example.test", {}, "GET", {
      maxRetries: 1,
      baseDelay: 0,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(352);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unsafe methods", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 503 }));

    await fetchWithRetry("https://api.example.test", { body: "payload" }, "POST", {
      maxRetries: 3,
      baseDelay: 0,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a non-replayable stream body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 503 }));
    const body = new ReadableStream<Uint8Array>();

    await fetchWithRetry("https://api.example.test", { body }, "PUT", {
      maxRetries: 3,
      baseDelay: 0,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries network failures for idempotent methods", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      fetchWithRetry("https://api.example.test", {}, "GET", {
        maxRetries: 1,
        baseDelay: 0,
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry network failures for unsafe methods", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    await expect(
      fetchWithRetry("https://api.example.test", { method: "POST" }, "POST", {
        maxRetries: 3,
        baseDelay: 0,
      }),
    ).rejects.toThrow("offline");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry an abort as a network failure", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Cancelled", "AbortError");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      controller.abort(abortError);
      return Promise.reject(abortError);
    });

    await expect(
      fetchWithRetry(
        "https://api.example.test",
        { method: "GET", signal: controller.signal },
        "GET",
        { maxRetries: 3, baseDelay: 0 },
      ),
    ).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels the backoff delay when the request is aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 503 }));
    const request = fetchWithRetry(
      "https://api.example.test",
      { method: "GET", signal: controller.signal },
      "GET",
      { maxRetries: 2, baseDelay: 1_000 },
    );
    const requestError = expect(request).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await requestError;
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the effective request method after request initialization", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 503 }));

    await fetchWithRetry("https://api.example.test", { method: "POST", body: "payload" }, "GET", {
      maxRetries: 3,
      baseDelay: 0,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
