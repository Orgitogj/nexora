export function shouldRefreshToken(
  status: number,
  authEnabled: boolean,
  hasRefreshHandler: boolean,
  alreadyRefreshed: boolean,
): boolean {
  return status === 401 && authEnabled && hasRefreshHandler && !alreadyRefreshed;
}
