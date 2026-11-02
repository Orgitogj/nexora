import type { ClientOptions, RequestOptions } from "./types.js";

export function createClient(options: ClientOptions) {
  async function request(path: string, requestOptions: RequestOptions): Promise<Response> {
    const url = `${options.baseUrl}${path}`;

    const init: RequestInit = {
      method: requestOptions.method,
    };

    if (requestOptions.headers !== undefined) {
      init.headers = requestOptions.headers;
    }

    if (requestOptions.body !== undefined) {
      init.body = requestOptions.body;
    }

    return fetch(url, init);
  }

  function get(path: string, headers?: Record<string, string>): Promise<Response> {
    return request(path, {
      method: "GET",
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  function post(
    path: string,
    body?: BodyInit,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return request(path, {
      method: "POST",
      ...(body !== undefined ? { body } : {}),
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  function put(path: string, body?: BodyInit, headers?: Record<string, string>): Promise<Response> {
    return request(path, {
      method: "PUT",
      ...(body !== undefined ? { body } : {}),
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  function patch(
    path: string,
    body?: BodyInit,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return request(path, {
      method: "PATCH",
      ...(body !== undefined ? { body } : {}),
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  function remove(path: string, headers?: Record<string, string>): Promise<Response> {
    return request(path, {
      method: "DELETE",
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  return {
    get,
    post,
    put,
    patch,
    delete: remove,
  };
}
