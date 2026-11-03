import type { QueryParams } from "./types.js";

export function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  const normalizedPath = path.replace(/^\/+/, "");

  const url = new URL(normalizedPath, normalizedBase);

  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}
