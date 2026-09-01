import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { GeoipService } from '../../common/geoip/geoip.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { WEATHER_PROVIDER, WeatherProvider, WeatherSnapshot } from './providers/weather.provider.interface';
import { GREETING_LABEL, bucketHour } from './time-of-day.util';

function isValidTimezone(tz: string | undefined): tz is string {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  // Reject anything weird; IANA names are letters / digits / + / - / _ / /.
  if (!/^[A-Za-z0-9+_\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cityFromTimezone(tz: string): string {
  // "America/New_York" → "New York", "Europe/London" → "London".
  // Last "/"-segment is the city, with underscores as separators.
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

export interface GreetingResponse {
  greeting: string;
  firstName: string | null;
  locationLabel: string | null;
  weather: WeatherSnapshot | null;
  localTimeIso: string;
}

interface GeoSlim {
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
  tz?: string;
}

@Injectable()
export class GreetingService {
  private readonly logger = new Logger(GreetingService.name);
  private readonly cacheTtl: number;
  private readonly weatherTtl: number;
  private readonly fallbackTz: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geoip: GeoipService,
    private readonly cache: RedisCacheService,
    @Inject(WEATHER_PROVIDER) private readonly weather: WeatherProvider,
    config: ConfigService,
  ) {
    this.cacheTtl = Number(config.get('GREETING_CACHE_TTL_SEC') ?? 60);
    this.weatherTtl = Number(config.get('WEATHER_CACHE_TTL_SEC') ?? 600);
    this.fallbackTz = config.get<string>('GEOIP_FALLBACK_TIMEZONE') ?? 'America/New_York';
  }

  async getForUser(userId: string, lat?: number, lng?: number, clientTz?: string): Promise<GreetingResponse> {
    const safeTz = isValidTimezone(clientTz) ? clientTz : undefined;
    const cacheKey = `greeting:${userId}:${lat ?? ''}:${lng ?? ''}:${safeTz ?? ''}`;
    const cached = await this.cache.get<GreetingResponse>(cacheKey);
    if (cached) return cached;

    const [user, device] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } }),
      this.prisma.device.findFirst({
        where: { userId, revokedAt: null },
        orderBy: { lastSeenAt: 'desc' },
      }),
    ]);

    const geo = this.resolveGeo(device?.ipLastSeen, device?.locationLastSeen as object | null, lat, lng);
    // Trust the client-supplied IANA tz over the geo-derived one — the
    // device knows itself; geo (IP / mmdb) is best-effort. Falls back to
    // the geo tz, then the configured default.
    const tz = safeTz ?? geo.tz ?? this.fallbackTz;
    const local = DateTime.now().setZone(tz);
    const key = bucketHour(local.hour);

    // City lookup, in order of accuracy:
    //   1) reverse geocode the *explicit* lat/lng with Nominatim — this is
    //      the user's current device-reported position, so it always
    //      outranks anything the device/IP record cached at login time.
    //   2) device / IP-derived city (already on `geo`)
    //   3) derive a friendly city from the resolved timezone
    // We never let the response sit at null — the client renders a stuck
    // "Locating…" placeholder when this is missing.
    if (lat != null && lng != null) {
      const rev = await this.reverseGeocodeCached(lat, lng);
      if (rev?.city) {
        geo.city = rev.city;
        geo.region = rev.region ?? geo.region;
        geo.country = rev.country ?? geo.country;
      }
    }
    const locationLabel =
      [geo.city, geo.region].filter(Boolean).join(', ') ||
      cityFromTimezone(tz);

    let weather: WeatherSnapshot | null = null;
    if (geo.lat != null && geo.lng != null) {
      weather = await this.getWeatherCached(geo.lat, geo.lng);
    }

    const response: GreetingResponse = {
      greeting: GREETING_LABEL[key],
      firstName: user?.firstName ?? null,
      locationLabel,
      weather,
      localTimeIso: local.toISO() ?? new Date().toISOString(),
    };
    await this.cache.set(cacheKey, response, this.cacheTtl);
    return response;
  }

  private resolveGeo(
    ip: string | undefined,
    locationLastSeen: object | null,
    explicitLat?: number,
    explicitLng?: number,
  ): GeoSlim {
    const fromDevice = (locationLastSeen ?? {}) as GeoSlim;
    const fromIp = ip ? this.geoip.resolve(ip) : {};
    const lat = explicitLat ?? fromDevice.lat ?? (fromIp as GeoSlim).lat;
    const lng = explicitLng ?? fromDevice.lng ?? (fromIp as GeoSlim).lng;
    return {
      city: fromDevice.city ?? (fromIp as GeoSlim).city,
      region: fromDevice.region ?? (fromIp as GeoSlim).region,
      country: fromDevice.country ?? (fromIp as GeoSlim).country,
      lat: lat != null ? Number(lat) : undefined,
      lng: lng != null ? Number(lng) : undefined,
    };
  }

  private async reverseGeocodeCached(
    lat: number,
    lng: number,
  ): Promise<{ city?: string; region?: string; country?: string } | null> {
    // Coarse cache key — 0.1° ≈ 11 km, plenty for a city label and keeps
    // Nominatim well under its 1 req/sec public-server limit.
    const rLat = Math.round(lat * 10) / 10;
    const rLng = Math.round(lng * 10) / 10;
    const key = `revgeo:${rLat}:${rLng}`;
    const cached = await this.cache.get<{ city?: string; region?: string; country?: string }>(key);
    if (cached) return cached;
    try {
      const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat: rLat, lon: rLng, format: 'json', zoom: 10, 'accept-language': 'en' },
        // Nominatim's usage policy requires a descriptive UA identifying the app.
        headers: { 'User-Agent': 'nova-bank-demo/1.0 (greeting widget)' },
        timeout: 4000,
      });
      const addr = (res.data?.address ?? {}) as Record<string, string | undefined>;
      const city =
        addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? addr.municipality ?? addr.county;
      const region = addr.state ?? addr.region;
      const country = addr.country;
      const out = { city, region, country };
      // Cache long: city-from-coords doesn't change, and we want to be a polite Nominatim citizen.
      await this.cache.set(key, out, 24 * 60 * 60);
      return out;
    } catch (err) {
      this.logger.warn(`reverse-geocode failed for ${rLat},${rLng}: ${(err as Error).message}`);
      return null;
    }
  }

  private async getWeatherCached(lat: number, lng: number): Promise<WeatherSnapshot | null> {
    const rLat = Math.round(lat * 10) / 10;
    const rLng = Math.round(lng * 10) / 10;
    const key = `weather:${rLat}:${rLng}`;
    const cached = await this.cache.get<WeatherSnapshot>(key);
    if (cached) return cached;
    try {
      const snapshot = await this.weather.fetch(rLat, rLng);
      await this.cache.set(key, snapshot, this.weatherTtl);
      return snapshot;
    } catch (err) {
      this.logger.warn(`weather fetch failed for ${rLat},${rLng}: ${(err as Error).message}`);
      return null;
    }
  }
}
