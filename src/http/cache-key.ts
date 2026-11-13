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

export function getResponseCacheTtl(
  response: Response,
  configuredTtl: number,
  receivedAt = Date.now(),
  now = Date.now(),
): number {
  if (!isCacheableResponse(response)) return 0;

  const cacheControl = response.headers.get("cache-control");
  const maxAge = getDeltaSeconds(cacheControl, "max-age");
  const age = getAge(response.headers.get("age"));
  const date = parseHttpDate(response.headers.get("date"));
  const expires = parseHttpDate(response.headers.get("expires"));
  const currentAge = Math.max(age, date === undefined ? 0 : receivedAt - date) + now - receivedAt;
  const freshnessLifetimes: number[] = [];

  if (maxAge !== undefined) {
    freshnessLifetimes.push(maxAge - currentAge);
  }
  if (expires !== undefined) {
    freshnessLifetimes.push(date === undefined ? expires - now - age : expires - date - currentAge);
  }

  if (freshnessLifetimes.length === 0) return configuredTtl;
  return Math.max(0, Math.min(configuredTtl, ...freshnessLifetimes));
}

function hasCacheControlDirective(value: string | null, directive: string): boolean {
  return (
    value?.split(",").some((part) => part.split("=", 1)[0]?.trim().toLowerCase() === directive) ??
    false
  );
}

function getDeltaSeconds(value: string | null, directive: string): number | undefined {
  const values = value
    ?.split(",")
    .map((part) => {
      const separator = part.indexOf("=");
      const name = (separator < 0 ? part : part.slice(0, separator)).trim().toLowerCase();
      if (name !== directive) return undefined;
      const rawValue = separator < 0 ? "" : part.slice(separator + 1).trim();
      const quotedValue = /^"(\d+)"$/.exec(rawValue)?.[1];
      const normalizedValue = quotedValue ?? (/^\d+$/.test(rawValue) ? rawValue : undefined);
      if (normalizedValue === undefined) return Number.NaN;
      const seconds = Number(normalizedValue);
      const milliseconds = seconds * 1_000;
      return Number.isSafeInteger(milliseconds) ? milliseconds : Number.NaN;
    })
    .filter((entry): entry is number => entry !== undefined);
  if (values === undefined || values.length === 0) return undefined;
  if (values.some((entry) => !Number.isFinite(entry))) return 0;
  return Math.min(...values);
}

function getAge(value: string | null): number {
  if (value === null) return 0;
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) return Number.POSITIVE_INFINITY;
  const seconds = Number(normalizedValue);
  const milliseconds = seconds * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : Number.POSITIVE_INFINITY;
}

function parseHttpDate(value: string | null): number | undefined {
  if (value === null) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
