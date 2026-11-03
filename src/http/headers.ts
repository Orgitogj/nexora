export function mergeHeaders(
  defaultHeaders?: Record<string, string>,
  requestHeaders?: Record<string, string>,
): Headers {
  const headers = new Headers(defaultHeaders);

  if (requestHeaders !== undefined) {
    for (const [key, value] of Object.entries(requestHeaders)) {
      headers.set(key, value);
    }
  }

  return headers;
}
