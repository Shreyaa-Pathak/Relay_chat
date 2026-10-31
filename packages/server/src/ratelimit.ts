/** Token bucket. Used per socket (messages, typing) and per key (auth). */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }
  take(now = Date.now(), n = 1): boolean {
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/**
 * Keyed limiter with bounded memory. On Vercel this is per function instance, so it slows down
 * abuse from one connection/instance but is not a global limit; see docs/SECURITY.md.
 */
export class KeyedLimiter {
  private buckets = new Map<string, TokenBucket>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly maxKeys = 10_000,
  ) {}
  take(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) {
        const first = this.buckets.keys().next().value;
        if (first !== undefined) this.buckets.delete(first);
      }
      b = new TokenBucket(this.capacity, this.refillPerSec, now);
      this.buckets.set(key, b);
    }
    return b.take(now);
  }
}
