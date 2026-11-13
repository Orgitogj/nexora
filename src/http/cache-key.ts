const REPRESENTATION_HEADERS = new Set(["accept", "accept-language"]);

export function createCacheKey(url: string, headers: Headers, method = "GET"): string {
  const accept = headers.get("accept") ?? "";
  const language = headers.get("accept-language") ?? "";
  return JSON.stringify([method.toUpperCase(), url, accept, language]);
}

export function hasUnsupportedCacheHeaders(headers: Headers): boolean {
  for (const name of headers.keys()) {
    if (!REPRESENTATION_HEADERS.has(name)) return true;
  }
  return false;
}

export function hasNoStoreDirective(headers: Headers): boolean {
  return hasCacheControlDirective(headers.get("cache-control"), "no-store");
}

export function isCacheableResponse(response: Response): boolean {
  if (response.status === 206) return false;
  const cacheControl = response.headers.get("cache-control");
  if (
    hasCacheControlDirective(cacheControl, "no-store") ||
    hasCacheControlDirective(cacheControl, "no-cache")
  ) {
    return false;
  }

  const vary = response.headers.get("vary");
  if (vary === null) return true;

  return vary.split(",").every((name) => {
    const normalizedName = name.trim().toLowerCase();
    return normalizedName !== "" && REPRESENTATION_HEADERS.has(normalizedName);
  });
}

function hasCacheControlDirective(value: string | null, directive: string): boolean {
  return (
    value?.split(",").some((part) => part.split("=", 1)[0]?.trim().toLowerCase() === directive) ??
    false
  );
}
