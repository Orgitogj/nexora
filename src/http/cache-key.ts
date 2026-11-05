export function createCacheKey(url: string, headers: Headers): string {
  // Only non-sensitive representation headers are included.
  // Authenticated requests are excluded from caching in client.ts.
  const accept = headers.get("accept") ?? "";
  const language = headers.get("accept-language") ?? "";
  return JSON.stringify(["GET", url, accept, language]);
}
