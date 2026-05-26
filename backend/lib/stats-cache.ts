/**
 * Simple in-memory TTL cache for stats responses.
 *
 * On Vercel serverless each warm lambda instance caches independently —
 * cold starts recompute, which is fine. The primary win is that a warm
 * instance serving the 30-second dashboard poll only hits the DB once
 * per TTL window instead of on every request.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class StatsCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

// Module-level singleton — survives across requests on the same warm lambda
export const statsCache = new StatsCache();

/** TTL for aggregated stats (cell imbalance, SOC zones, aggregates) — 5 minutes */
export const STATS_TTL_MS = 5 * 60 * 1000;

/** TTL for the latest snapshot (refreshed on every poll) — never cached */
// Latest is always fetched live; only heavy aggregates are cached.
