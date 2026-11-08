import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import { createInterceptors } from "./interceptors.js";
import type { RequestInterceptorContext } from "./interceptor-types.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("Interceptors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs request interceptors in registration order", async () => {
    const interceptors = createInterceptors();
    const order: number[] = [];
    interceptors.request.use((context) => {
      order.push(1);
      return context;
    });
    interceptors.request.use((context) => {
      order.push(2);
      return context;
    });

    await interceptors.request.run({ url: "https://api.example.test", init: {} });

    expect(order).toEqual([1, 2]);
  });

  it("runs response interceptors in registration order", async () => {
    const interceptors = createInterceptors();
    const order: number[] = [];
    interceptors.response.use((response) => {
      order.push(1);
      return response;
    });
    interceptors.response.use((response) => {
      order.push(2);
      return response;
    });

    await interceptors.response.run(jsonResponse({ ok: true }));

    expect(order).toEqual([1, 2]);
  });

  it("allows request interceptors to modify headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient({ baseUrl: "https://api.example.test" });
    client.interceptors.request.use(({ init, ...context }) => {
      const headers = new Headers(init.headers);
      headers.set("X-Trace", "trace-id");
      return { ...context, init: { ...init, headers } };
    });

    await client.get("/status");

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-trace")).toBe("trace-id");
  });

  it("allows response interceptors to transform responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ original: true }));
    const client = createClient({ baseUrl: "https://api.example.test" });
    client.interceptors.response.use(() => jsonResponse({ transformed: true }));

    await expect(client.get("/status")).resolves.toEqual({ transformed: true });
  });

  it("propagates request interceptor errors through the error chain", async () => {
    const client = createClient({ baseUrl: "https://api.example.test" });
    const interceptorError = new Error("request rejected");
    client.interceptors.request.use(() => {
      throw interceptorError;
    });
    const handleError = vi.fn((error: unknown) => error);
    client.interceptors.error.use(handleError);

    await expect(client.get("/status")).rejects.toBe(interceptorError);
    expect(handleError).toHaveBeenCalledWith(interceptorError);
  });

  it("supports removing an interceptor", async () => {
    const client = createClient({ baseUrl: "https://api.example.test" });
    const handler = vi.fn((context: RequestInterceptorContext) => context);
    const id = client.interceptors.request.use(handler);
    client.interceptors.request.eject(id);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await client.get("/status");

    expect(handler).not.toHaveBeenCalled();
  });

  it("uses a handler snapshot when interceptors change during execution", async () => {
    const interceptors = createInterceptors();
    const calls: string[] = [];
    let secondId = -1;
    interceptors.request.use((context) => {
      calls.push("first");
      interceptors.request.eject(secondId);
      interceptors.request.use((nextContext) => {
        calls.push("third");
        return nextContext;
      });
      return context;
    });
    secondId = interceptors.request.use((context) => {
      calls.push("second");
      return context;
    });

    const context = { url: "https://api.example.test", init: {} };
    await interceptors.request.run(context);
    expect(calls).toEqual(["first", "second"]);

    calls.length = 0;
    await interceptors.request.run(context);
    expect(calls).toEqual(["first", "third"]);
  });

  it("awaits asynchronous interceptors in registration order", async () => {
    const interceptors = createInterceptors();
    const calls: string[] = [];
    interceptors.request.use(async (context) => {
      await Promise.resolve();
      calls.push("first");
      return context;
    });
    interceptors.request.use((context) => {
      calls.push("second");
      return context;
    });

    await interceptors.request.run({ url: "https://api.example.test", init: {} });

    expect(calls).toEqual(["first", "second"]);
  });
});
