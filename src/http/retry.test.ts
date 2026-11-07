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
});
