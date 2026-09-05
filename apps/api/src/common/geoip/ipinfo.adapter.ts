import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeoLocation } from './maxmind.adapter';
import type { GeoipAdapter } from './geoip.adapter';

interface CacheEntry {
  value: GeoLocation;
  exp: number;
}

/**
 * IP → location via the IPinfo HTTPS API (ipinfo.io). More current/accurate
 * than the free MaxMind DB, and works from any host (port 443). Results are
 * cached in-memory (IP → location is stable) so a burst of requests from one
 * IP costs one API call, keeping well inside the free 50k/month tier.
 *
 * Env:
 *   IPINFO_TOKEN — API token from ipinfo.io (recommended). Without it, IPinfo
 *                  allows a small unauthenticated daily quota.
 *
 * Never throws — returns {} on any error/timeout so callers degrade gracefully.
 */
@Injectable()
export class IpinfoAdapter implements GeoipAdapter {
  private readonly logger = new Logger(IpinfoAdapter.name);
  private readonly token: string;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly OK_TTL_MS = 24 * 60 * 60 * 1000; // stable → cache a day
  private readonly MISS_TTL_MS = 5 * 60 * 1000; // retry misses sooner
  private readonly MAX_ENTRIES = 5000;
  private readonly TIMEOUT_MS = 2500;

  constructor(config: ConfigService) {
    this.token = config.get<string>('IPINFO_TOKEN') ?? '';
  }

  async lookup(ip: string): Promise<GeoLocation> {
    const now = Date.now();
    const cached = this.cache.get(ip);
    if (cached && cached.exp > now) return cached.value;

    const value = await this.fetch(ip);
    const ttl = value.city || value.countryCode ? this.OK_TTL_MS : this.MISS_TTL_MS;
    this.put(ip, value, now + ttl);
    return value;
  }

  private async fetch(ip: string): Promise<GeoLocation> {
    const url =
      `https://ipinfo.io/${encodeURIComponent(ip)}/json` +
      (this.token ? `?token=${encodeURIComponent(this.token)}` : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        this.logger.warn(`ipinfo HTTP ${res.status} for ${ip}`);
        return {};
      }
      const d = (await res.json()) as {
        city?: string;
        region?: string;
        country?: string; // ISO-3166 alpha-2
        loc?: string; // "lat,lng"
        bogon?: boolean;
      };
      if (d.bogon) return {}; // reserved/private IP
      const [latStr, lngStr] = (d.loc ?? '').split(',');
      const cc = d.country?.toUpperCase();
      const lat = latStr ? Number(latStr) : undefined;
      const lng = lngStr ? Number(lngStr) : undefined;
      return {
        city: d.city || undefined,
        region: d.region || undefined,
        // IPinfo returns only the country CODE; expand to a name for display.
        country: cc ? countryName(cc) : undefined,
        countryCode: cc || undefined,
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
      };
    } catch (e) {
      this.logger.warn(`ipinfo lookup failed for ${ip}: ${(e as Error).message}`);
      return {};
    } finally {
      clearTimeout(timer);
    }
  }

  private put(ip: string, value: GeoLocation, exp: number) {
    if (this.cache.size >= this.MAX_ENTRIES) {
      // Bound memory: drop the oldest ~10% (insertion order).
      const drop = Math.ceil(this.MAX_ENTRIES * 0.1);
      let i = 0;
      for (const k of this.cache.keys()) {
        this.cache.delete(k);
        if (++i >= drop) break;
      }
    }
    this.cache.set(ip, { value, exp });
  }
}

/** ISO-3166 alpha-2 → English country name (e.g. "ZA" → "South Africa"). */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
