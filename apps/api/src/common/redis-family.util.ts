/**
 * Railway's private network (*.railway.internal) is IPv6-only, and ioredis
 * defaults to IPv4 DNS — so a plain `new Redis(url)` can't resolve the host.
 * Returns `{ family: 0 }` (dual-stack lookup) for those hosts, `{}` otherwise,
 * so the same REDIS_URL works locally, on Railway, and on external providers
 * without needing a `?family=0` query string. Mirrors the BullMQ config fix.
 */
export function redisFamilyOption(redisUrl: string): { family?: number } {
  try {
    return new URL(redisUrl).hostname.endsWith('.railway.internal')
      ? { family: 0 }
      : {};
  } catch {
    return {};
  }
}
