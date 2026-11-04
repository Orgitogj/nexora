import type { AuthOptions } from "./types.js";

export function createTokenRefresher(auth: AuthOptions) {
  let refreshPromise: Promise<string | null> | null = null;

  function refresh(): Promise<string | null> {
    if (auth.refreshToken === undefined) {
      return Promise.resolve(null);
    }

    if (refreshPromise !== null) {
      return refreshPromise;
    }

    const operation = Promise.resolve().then(() => auth.refreshToken!());

    refreshPromise = operation;

    void operation.then(
      () => {
        if (refreshPromise === operation) {
          refreshPromise = null;
        }
      },
      () => {
        if (refreshPromise === operation) {
          refreshPromise = null;
        }
      },
    );

    return operation;
  }

  return { refresh };
}
