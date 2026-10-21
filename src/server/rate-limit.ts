/**
 * Fixed-window, in-memory rate limiter keyed by client. Suitable for a single
 * instance; swap for a Redis-backed limiter when running several replicas.
 */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Returns 0 if allowed, otherwise seconds until the window resets. */
  hit(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.prune(now);
      this.windows.set(key, { start: now, count: 1 });
      return 0;
    }
    if (w.count >= this.limit) return Math.ceil((w.start + this.windowMs - now) / 1000);
    w.count++;
    return 0;
  }

  private prune(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}

/**
 * Client identity for rate limiting.
 *
 * Each trusted reverse proxy appends the address of its peer to X-Forwarded-For,
 * so with `trustedHops` proxies the real client is `trustedHops` entries from the
 * right; anything further left is client-supplied and ignored.
 *
 * With 0 hops (app exposed directly) Next.js fills the header with the socket
 * address only when the client did not send one, so a direct client can spoof
 * it. Production deployments should run behind a proxy and set TRUST_PROXY_HOPS;
 * the global queue limit still caps total load either way.
 */
export function clientKey(headers: Headers, trustedHops: number): string {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[Math.max(0, chain.length - Math.max(1, trustedHops))];
  return ip || "unknown";
}
