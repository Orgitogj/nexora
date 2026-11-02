import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "../src/index.js";

describe("createClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a GET request", async () => {
    const response = new Response(null, {
      status: 200,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const client = createClient({
      baseUrl: "https://api.example.com",
    });

    const result = await client.get("/users");

    expect(fetchMock).toHaveBeenCalledOnce();

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/users", {
      method: "GET",
      headers: undefined,
      body: undefined,
    });

    expect(result).toBe(response);
  });

  it("sends a POST request with a body and headers", async () => {
    const response = new Response(null, {
      status: 201,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const client = createClient({
      baseUrl: "https://api.example.com",
    });

    const body = JSON.stringify({
      name: "Orgito",
    });

    const result = await client.post("/users", body, {
      "Content-Type": "application/json",
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    expect(result).toBe(response);
  });

  it("sends a PUT request", async () => {
    const response = new Response(null, {
      status: 200,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const client = createClient({
      baseUrl: "https://api.example.com",
    });

    const body = JSON.stringify({
      name: "Updated",
    });

    await client.put("/users/1", body);

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/users/1", {
      method: "PUT",
      headers: undefined,
      body,
    });
  });

  it("sends a PATCH request", async () => {
    const response = new Response(null, {
      status: 200,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const client = createClient({
      baseUrl: "https://api.example.com",
    });

    const body = JSON.stringify({
      name: "Patched",
    });

    await client.patch("/users/1", body);

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/users/1", {
      method: "PATCH",
      headers: undefined,
      body,
    });
  });

  it("sends a DELETE request", async () => {
    const response = new Response(null, {
      status: 204,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const client = createClient({
      baseUrl: "https://api.example.com",
    });

    const result = await client.delete("/users/1");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/users/1", {
      method: "DELETE",
      headers: undefined,
      body: undefined,
    });

    expect(result).toBe(response);
  });
});
