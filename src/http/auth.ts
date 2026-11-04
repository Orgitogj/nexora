import type { AuthOptions } from "./types.js";

export async function getAccessToken(auth: AuthOptions): Promise<string | null> {
  return auth.getToken();
}

export function applyBearerToken(headers: Headers, token: string | null): void {
  if (token === null) {
    headers.delete("Authorization");
    return;
  }

  headers.set("Authorization", `Bearer ${token}`);
}
