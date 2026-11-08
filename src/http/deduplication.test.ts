import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("Request deduplication", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shares one network call for identical simultaneous GET requests", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const client = createClient({
      baseUrl: "https://api.example.test",
      deduplication: true,
      credentials: "omit",
    });

    const first = client.get("/users/1");
    const second = client.get("/users/1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    resolveFetch(jsonResponse({ id: 1 }));

    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 1 }, { id: 1 }]);
  });

  it("does not deduplicate different URLs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      deduplication: true,
      credentials: "omit",
    });

    await Promise.all([client.get("/one"), client.get("/two")]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes relevant representation headers in the deduplication key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      deduplication: true,
      credentials: "omit",
    });

    await Promise.all([
      client.get("/users", { headers: { Accept: "application/json" } }),
      client.get("/users", { headers: { Accept: "text/plain" } }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes completed requests from the in-flight store", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      deduplication: true,
      credentials: "omit",
    });

    await client.get("/users");
    await client.get("/users");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cleans up failed requests so a later request can retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({
      baseUrl: "https://api.example.test",
      deduplication: true,
      credentials: "omit",
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/users")).rejects.toThrow("offline");
    await expect(client.get("/users")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not deduplicate requests with different custom headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      deduplication: true,
      credentials: "omit",
    });

    await Promise.all([
      client.get("/users", { headers: { "X-Tenant": "one" } }),
      client.get("/users", { headers: { "X-Tenant": "two" } }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not deduplicate requests that can send ambient cookies", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createClient({ baseUrl: "https://api.example.test", deduplication: true });

    await Promise.all([client.get("/users"), client.get("/users")]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps independently cancellable requests separate and clears both in-flight entries", async () => {
    const resolveRequests: Array<(response: Response) => void> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((resolve, reject) => {
          resolveRequests.push(resolve);
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
      deduplication: true,
      credentials: "omit",
      retry: { maxRetries: 0 },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = client.get("/users", { signal: firstController.signal });
    const second = client.get("/users", { signal: secondController.signal });
    const firstError = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    firstController.abort(new DOMException("Cancelled", "AbortError"));
    resolveRequests[1]?.(jsonResponse({ id: 1 }));

    await firstError;
    await expect(second).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
