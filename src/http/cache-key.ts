export function createCacheKey(url: string, headers: Headers, method = "GET"): string {
  const accept = headers.get("accept") ?? "";
  const language = headers.get("accept-language") ?? "";
  return JSON.stringify([method.toUpperCase(), url, accept, language]);
}
