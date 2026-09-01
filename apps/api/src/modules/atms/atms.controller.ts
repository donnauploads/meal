import { BadRequestException, Controller, Get, Logger, ParseFloatPipe, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { AtmsService } from './atms.service';

@UseGuards(JwtAccessGuard)
@Controller('atms')
export class AtmsController {
  private readonly logger = new Logger(AtmsController.name);
  constructor(private readonly atms: AtmsService) {}

  @Get('nearby')
  async nearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Math.max(Number(limitRaw ?? 10) || 10, 1), 25);
    const rows = await this.atms.nearby(lat, lon, limit);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      address: r.address,
      distanceMeters: Math.round(r.distanceMeters),
      lat: r.lat,
      lon: r.lon,
      feeCentsEstimate: r.feeCentsEstimate,
    }));
  }

  /**
   * Server-side geocoder proxy. The FE deposit-cash page previously hit
   * Nominatim directly from the browser; that's brittle (ad-blockers
   * commonly block `nominatim.openstreetmap.org`, and some networks block
   * cross-origin from the dev host). Going through the API gives us:
   *   - a controllable User-Agent that respects Nominatim usage policy
   *   - retry-with-relaxed-query on empty result
   *   - room to swap in a paid geocoder later without touching the FE
   */
  @Get('geocode')
  async geocode(@Query('q') q?: string, @Query('limit') limitRaw?: string) {
    const query = (q ?? '').trim();
    if (!query) throw new BadRequestException('q is required');
    const limit = Math.min(Math.max(Number(limitRaw ?? 5) || 5, 1), 10);

    const tryFetch = async (term: string) => {
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?format=json&addressdetails=1&limit=${limit}` +
        `&q=${encodeURIComponent(term)}`;
      try {
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'nova-bank-demo/1.0 (deposit-cash geocoder)',
            'Accept': 'application/json',
            'Accept-Language': 'en',
          },
        });
        if (!r.ok) {
          this.logger.warn(`Nominatim ${term} → HTTP ${r.status}`);
          return [];
        }
        return (await r.json()) as NominatimHit[];
      } catch (err) {
        this.logger.warn(`Nominatim ${term} network error: ${(err as Error).message}`);
        return [];
      }
    };

    // First attempt with the raw query, then a relaxed retry: drop any
    // trailing ZIP+4 suffix, strip apartment/unit fragments, collapse
    // whitespace. These usually rescue queries like
    // "123 Main St, Apt 4B, Brooklyn, NY 11211-4567".
    let hits = await tryFetch(query);
    if (hits.length === 0) {
      const relaxed = query
        .replace(/(?:apt|unit|suite|ste|#)\s*[\w-]+/gi, '')
        .replace(/-\d{4}\b/g, '') // strip ZIP+4 trailing digits
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (relaxed && relaxed !== query) {
        hits = await tryFetch(relaxed);
      }
    }
    if (hits.length === 0) {
      // Surface a structured empty so the FE can render a clean
      // "couldn't find" rather than a network error.
      return [] as GeocodeResult[];
    }

    return hits.map<GeocodeResult>((h) => ({
      lat: Number(h.lat),
      lon: Number(h.lon),
      displayName: h.display_name,
      city:
        (typeof h.address?.city === 'string' && h.address.city) ||
        (typeof h.address?.town === 'string' && h.address.town) ||
        (typeof h.address?.village === 'string' && h.address.village) ||
        null,
      country: typeof h.address?.country === 'string' ? h.address.country : null,
      countryCode:
        typeof h.address?.country_code === 'string'
          ? h.address.country_code.toUpperCase()
          : null,
    }));
  }
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, unknown>;
}

interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
}
