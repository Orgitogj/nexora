import { isJsonContentType } from "./content-type.js";
import { NexoraResponseError } from "./response-errors.js";
import type { ResponseOptions } from "./response-validator.js";

export async function parseJson<T>(
  response: Response,
  options: ResponseOptions<T> = {},
): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const body = await response.text();

  if (body.trim() === "") {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type");

  if (!isJsonContentType(contentType)) {
    throw new NexoraResponseError("Expected a JSON response", response.status);
  }

  let data: unknown;

  try {
    data = JSON.parse(body) as unknown;
  } catch (error) {
    throw new NexoraResponseError("Invalid JSON response", response.status, { cause: error });
  }

  if (options.validate !== undefined) {
    try {
      return options.validate(data);
    } catch (error) {
      throw new NexoraResponseError("Response validation failed", response.status, {
        cause: error,
      });
    }
  }

  return data as T;
}
