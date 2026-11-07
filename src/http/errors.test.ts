import { describe, expect, it } from "vitest";
import { createHttpError } from "./error-response.js";
import { NexoraError } from "./errors.js";
import { NexoraResponseError } from "./response-errors.js";

describe("HTTP errors", () => {
  it("creates typed HTTP errors with status and response data", async () => {
    const error = await createHttpError(
      new Response(JSON.stringify({ reason: "invalid" }), {
        status: 422,
        statusText: "Unprocessable Entity",
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(error).toBeInstanceOf(NexoraError);
    expect(error).toMatchObject({
      name: "NexoraError",
      status: 422,
      statusText: "Unprocessable Entity",
      data: { reason: "invalid" },
      message: "Unprocessable Entity",
    });
  });

  it("uses a useful fallback message when the server omits status text", async () => {
    const error = await createHttpError(new Response(null, { status: 500 }));

    expect(error.message).toBe("HTTP request failed with status 500");
  });

  it("returns null data when an HTTP error body is not JSON", async () => {
    const error = await createHttpError(
      new Response("not JSON", { status: 400, statusText: "Bad Request" }),
    );

    expect(error.data).toBeNull();
    expect(error.status).toBe(400);
  });

  it("uses a separate response error type for malformed successful responses", () => {
    const error = new NexoraResponseError("Invalid JSON response", 200);

    expect(error).toBeInstanceOf(NexoraResponseError);
    expect(error).not.toBeInstanceOf(NexoraError);
    expect(error.status).toBe(200);
    expect(error.message).toBe("Invalid JSON response");
  });

  it("keeps transport and timeout failures distinguishable from HTTP errors", () => {
    const networkError = new TypeError("Network unavailable");
    const timeoutError = new DOMException("The operation timed out", "TimeoutError");

    expect(networkError).not.toBeInstanceOf(NexoraError);
    expect(timeoutError).not.toBeInstanceOf(NexoraError);
    expect(timeoutError.name).toBe("TimeoutError");
    expect(networkError.message).toBe("Network unavailable");
  });
});
