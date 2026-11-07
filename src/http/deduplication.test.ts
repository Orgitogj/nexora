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
    const client = createClient({ baseUrl: "https://api.example.test", deduplication: true });

    await Promise.all([client.get("/one"), client.get("/two")]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes relevant representation headers in the deduplication key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createClient({ baseUrl: "https://api.example.test", deduplication: true });

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
    const client = createClient({ baseUrl: "https://api.example.test", deduplication: true });

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
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/users")).rejects.toThrow("offline");
    await expect(client.get("/users")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
