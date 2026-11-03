export function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
  return Math.min(baseDelay * 2 ** attempt, maxDelay);
}
