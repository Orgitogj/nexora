import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Authentication", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the current access token to requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: { getToken: () => "access-token" },
    });

    await client.get("/private");

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("refreshes an expired access token and retries the request", async () => {
    let token = "expired";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      if (new Headers(init?.headers).get("authorization") === "Bearer expired") {
        return Promise.resolve(jsonResponse({ error: "expired" }, 401));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const refreshToken = vi.fn(() => {
      token = "fresh";
      return Promise.resolve(token);
    });
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: { getToken: () => token, refreshToken },
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/private")).resolves.toEqual({ ok: true });
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer fresh",
    );
  });

  it("shares one refresh operation across concurrent unauthorized requests", async () => {
    let token = "expired";
    let resolveRefresh!: (value: string) => void;
    const refreshToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      if (new Headers(init?.headers).get("authorization") === "Bearer expired") {
        return Promise.resolve(jsonResponse({ error: "expired" }, 401));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: { getToken: () => token, refreshToken },
      retry: { maxRetries: 0 },
    });

    const first = client.get("/first");
    const second = client.get("/second");
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledOnce());
    token = "fresh";
    resolveRefresh("fresh");

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it("propagates refresh failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "expired" }, 401));
    const refreshError = new Error("refresh unavailable");
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: {
        getToken: () => "expired",
        refreshToken: () => Promise.reject(refreshError),
      },
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/private")).rejects.toBe(refreshError);
  });

  it("does not cache a missing token or retry when no refresh handler exists", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: { getToken: () => null },
      cache: { enabled: true },
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/private")).rejects.toMatchObject({ status: 401 });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a null refresh result as a refresh failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: { getToken: () => "expired", refreshToken: () => Promise.resolve(null) },
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/private")).rejects.toThrow("Unable to refresh access token");
  });

  it("does not refresh repeatedly when the retried request is still unauthorized", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ error: "unauthorized" }, 401)));
    const refreshToken = vi.fn(() => Promise.resolve("new-token"));
    const client = createClient({
      baseUrl: "https://api.example.test",
      auth: { getToken: () => "old-token", refreshToken },
      retry: { maxRetries: 0 },
    });

    await expect(client.get("/private")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshToken).toHaveBeenCalledOnce();
  });
});
