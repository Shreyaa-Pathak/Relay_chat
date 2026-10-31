/** Exponential backoff with "equal jitter": half fixed, half random. Capped at 30 s. */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 30_000, rand: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + rand() * (exp / 2));
}

/**
 * When to start a planned reconnect, before the server's max connection lifetime.
 * For Vercel Hobby (server closes at 290 s, function limit 300 s) this lands between ~232 s and ~275 s.
 */
export function plannedReconnectDelay(maxConnectionMs: number, rand: () => number = Math.random): number {
  return Math.round(maxConnectionMs * (0.8 + rand() * 0.15));
}
