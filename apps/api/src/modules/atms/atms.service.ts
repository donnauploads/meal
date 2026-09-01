import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

// Multiple public Overpass instances. We round-robin so a rate-limit on
// one doesn't take the whole feature down. Override with OVERPASS_URL (or
// OVERPASS_URLS, comma-separated) for a private mirror.
const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
const OVERPASS_URLS = (
  process.env.OVERPASS_URLS ??
  process.env.OVERPASS_URL ??
  DEFAULT_OVERPASS_URLS.join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// In-memory cache. Buckets coords to ~1.1 km so two requests from the
// same vicinity reuse one Overpass call.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rows: NearbyAtm[] }>();

function cacheKey(lat: number, lon: number, limit: number) {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}:${limit}`;
}

// Retail chains that publicly accept third-party cash deposits via Green
// Dot / Visa ReadyLink rails. Used to surface a fee estimate when a hit
// from Overpass matches one of these names; for everything else we just
// show "Fee varies".
const RETAIL_CHAINS: { match: RegExp; canonical: string; feeCents: number }[] = [
  { match: /\bwalmart\b/i, canonical: 'Walmart', feeCents: 0 },
  { match: /\bwalgreens\b/i, canonical: 'Walgreens', feeCents: 0 },
  { match: /\bcvs\b/i, canonical: 'CVS', feeCents: 0 },
  { match: /\btarget\b/i, canonical: 'Target', feeCents: 0 },
  { match: /\b7[\s-]?eleven\b/i, canonical: '7-Eleven', feeCents: 495 },
  { match: /\brite[\s-]?aid\b/i, canonical: 'Rite Aid', feeCents: 495 },
  { match: /\bfamily dollar\b/i, canonical: 'Family Dollar', feeCents: 495 },
  { match: /\bdollar general\b/i, canonical: 'Dollar General', feeCents: 495 },
  { match: /\bdollar tree\b/i, canonical: 'Dollar Tree', feeCents: 495 },
];

export interface NearbyAtm {
  id: string;
  name: string;
  /** "bank", "atm", or "retail". Helps the UI label icons + fee notes. */
  kind: 'bank' | 'atm' | 'retail';
  address: string;
  distanceMeters: number;
  lat: number;
  lon: number;
  /** null → fee unknown / depends on customer's bank. */
  feeCentsEstimate: number | null;
}

type OverpassElement = {
  id: number;
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

@Injectable()
export class AtmsService {
  private readonly logger = new Logger(AtmsService.name);

  async nearby(lat: number, lon: number, limit: number): Promise<NearbyAtm[]> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new BadRequestException('lat and lon are required');
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new BadRequestException('lat/lon out of range');
    }

    const key = cacheKey(lat, lon, limit);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.rows;
    }

    // Prefer Foursquare when an API key is configured — better data + no
    // public rate-limiting. Fall back to OSM Overpass otherwise so this
    // still works in dev without a key. Widen the search radius on rural
    // misses so a remote location still surfaces *something*.
    const fsqKey = process.env.FOURSQUARE_API_KEY;
    let results: NearbyAtm[] = [];
    if (fsqKey) {
      for (const radius of [15_000, 50_000, 100_000]) {
        results = await this.queryFoursquare(lat, lon, limit, fsqKey, radius);
        if (results.length > 0) break;
      }
    } else {
      results = await this.queryOverpass(lat, lon, 15_000);
    }

    const sliced = results.slice(0, limit);
    // Only cache successful, non-empty results — empty/error responses
    // shouldn't pin themselves for 10 minutes.
    if (sliced.length > 0) {
      cache.set(key, { at: Date.now(), rows: sliced });
    }
    return sliced;
  }

  private async queryFoursquare(
    lat: number,
    lon: number,
    limit: number,
    apiKey: string,
    radius: number = 15_000,
  ): Promise<NearbyAtm[]> {
    // Don't pin to category IDs — Foursquare's category taxonomy has
    // shifted between the legacy v3 and the new Service API, and a wrong
    // ID returns `[]` rather than an error. Instead pull all nearby
    // places sorted by distance and filter by category *name* or chain
    // in JS below. The text query nudges the API toward our intent.
    const params = new URLSearchParams({
      ll: `${lat},${lon}`,
      radius: String(radius),
      query: 'bank atm',
      limit: '50',
      sort: 'DISTANCE',
    });

    // Foursquare migrated in 2024 from `api.foursquare.com/v3/places/*` to
    // `places-api.foursquare.com/places/*`. Newer Service API keys only
    // work on the new host. Try the new host first, fall back to legacy.
    const attempts: { url: string; auth: string; version?: string }[] = [
      {
        url: `https://places-api.foursquare.com/places/search?${params.toString()}`,
        auth: `Bearer ${apiKey}`,
        version: '2025-06-17',
      },
      {
        url: `https://api.foursquare.com/v3/places/search?${params.toString()}`,
        auth: apiKey,
      },
    ];
    const keyHint = `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
    let res: Response | null = null;
    let lastStatus = 0;
    let lastBody = '';
    let lastUrl = '';

    for (const a of attempts) {
      try {
        const headers: Record<string, string> = {
          Authorization: a.auth,
          Accept: 'application/json',
        };
        if (a.version) headers['X-Places-Api-Version'] = a.version;
        const r = await fetch(a.url, { headers });
        if (r.ok) {
          res = r;
          break;
        }
        lastStatus = r.status;
        lastBody = (await r.text().catch(() => '')).slice(0, 240);
        lastUrl = a.url.split('?')[0]!;
        this.logger.warn(
          `Foursquare ${lastUrl} → HTTP ${lastStatus}: ${lastBody}`,
        );
        // Don't keep trying on 4xx that isn't auth-related.
        if (![401, 403, 404].includes(r.status)) break;
      } catch (err) {
        this.logger.warn(`Foursquare network error: ${(err as Error).message}`);
        lastBody = (err as Error).message;
      }
    }

    if (!res) {
      this.logger.warn(
        `Foursquare all attempts failed. key=${keyHint} status=${lastStatus}`,
      );
      if (lastStatus === 429) {
        throw new HttpException(
          'Map service is rate-limiting requests. Try again in a moment.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (lastStatus === 401 || lastStatus === 403) {
        throw new ServiceUnavailableException(
          'Foursquare rejected the API key. Make sure FOURSQUARE_API_KEY is a Service API Key (starts with fsq3), not the OAuth Client Secret.',
        );
      }
      // Include upstream status in the response so the FE / browser
      // surface a useful diagnostic instead of a generic 503.
      throw new ServiceUnavailableException(
        `Map service unavailable (upstream ${lastStatus || 'no response'}): ${lastBody.slice(0, 120)}`,
      );
    }

    const data = (await res.json()) as { results: FoursquarePlace[] };
    this.logger.log(
      `Foursquare ok: received ${data.results?.length ?? 0} candidates near ${lat.toFixed(3)},${lon.toFixed(3)}`,
    );
    const out: NearbyAtm[] = [];

    for (const p of data.results ?? []) {
      const name = p.name?.trim();
      if (!name) continue;
      const placeLat =
        p.geocodes?.main?.latitude ?? p.latitude ?? null;
      const placeLon =
        p.geocodes?.main?.longitude ?? p.longitude ?? null;
      if (typeof placeLat !== 'number' || typeof placeLon !== 'number') continue;

      const chain = RETAIL_CHAINS.find((c) => c.match.test(name));
      // Match by category name (stable across taxonomy revisions) rather
      // than numeric ID. Anything containing "bank" or "atm" qualifies.
      const catNames = (p.categories ?? []).map((c) => c.name.toLowerCase());
      const isBank = catNames.some((n) => /\bbank\b/.test(n));
      const isAtm = catNames.some((n) => /\batm\b/.test(n));
      const kind: NearbyAtm['kind'] = isBank
        ? 'bank'
        : isAtm
          ? 'atm'
          : 'retail';

      // For non-bank / non-ATM hits, drop anything that isn't a known
      // cash-deposit chain — the broader categories pull in too many
      // irrelevant stores.
      if (kind === 'retail' && !chain) continue;

      out.push({
        id: `fsq/${p.fsq_id}`,
        name: chain?.canonical ?? name,
        kind,
        address: formatFsqAddress(p.location),
        distanceMeters: typeof p.distance === 'number'
          ? p.distance
          : haversine(lat, lon, placeLat, placeLon),
        lat: placeLat,
        lon: placeLon,
        feeCentsEstimate: chain ? chain.feeCents : null,
      });
    }

    out.sort((a, b) => a.distanceMeters - b.distanceMeters);
    this.logger.log(`Foursquare matched ${out.length} relevant results`);
    return out;
  }

  private async queryOverpass(lat: number, lon: number, radius: number): Promise<NearbyAtm[]> {
    // Banks + ATMs + a short list of retail chains that publicly accept
    // cash deposit. Kept simple: complex name regexes were tripping the
    // Overpass parser (406). Chain matching happens later in JS by the
    // RETAIL_CHAINS table.
    const chainNames =
      'Walmart|Walgreens|CVS|Target|7-Eleven|7 Eleven|Rite Aid|Family Dollar|Dollar General|Dollar Tree';
    const query =
      `[out:json][timeout:25];` +
      `(` +
        `node["amenity"="bank"](around:${radius},${lat},${lon});` +
        `way["amenity"="bank"](around:${radius},${lat},${lon});` +
        `node["amenity"="atm"](around:${radius},${lat},${lon});` +
        `node["name"~"${chainNames}",i](around:${radius},${lat},${lon});` +
        `way["name"~"${chainNames}",i](around:${radius},${lat},${lon});` +
      `);` +
      `out center 120;`;

    let res: Response | null = null;
    let lastError: { status?: number; body?: string } = {};
    // Try each instance until one responds. Stop on first success, also
    // stop early if we get a non-429 error (no point retrying a 400).
    for (const url of OVERPASS_URLS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'nova-bank-demo/1.0',
          },
          body: new URLSearchParams({ data: query }).toString(),
        });
        if (r.ok) {
          res = r;
          break;
        }
        lastError = { status: r.status, body: (await r.text()).slice(0, 200) };
        this.logger.warn(`Overpass ${url} → HTTP ${r.status}`);
        if (r.status !== 429 && r.status !== 503 && r.status !== 504) break;
      } catch (err) {
        this.logger.warn(`Overpass ${url} network error: ${(err as Error).message}`);
        lastError = { body: (err as Error).message };
      }
    }

    if (!res) {
      // All instances failed — surface a clear error so the FE can show
      // "try again in a moment" rather than a generic network error.
      if (lastError.status === 429) {
        throw new HttpException(
          'Map service is rate-limiting requests right now. Try again in a moment.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        `Map service unavailable: ${lastError.body ?? 'unknown'}`,
      );
    }

    const json = (await res.json()) as { elements: OverpassElement[] };
    const out: NearbyAtm[] = [];

    for (const el of json.elements ?? []) {
      const p = pointOf(el);
      if (!p) continue;
      const tags = el.tags ?? {};
      const amenity = tags.amenity;
      const shop = tags.shop;

      // Skip standalone ATMs that explicitly say they don't accept deposits.
      if (amenity === 'atm' && tags.deposit === 'no') continue;

      const rawName = tags.name?.trim() ||
        tags.operator?.trim() ||
        tags.brand?.trim() ||
        (amenity === 'bank' ? 'Bank branch'
          : amenity === 'atm' ? 'ATM'
          : null);
      if (!rawName) continue;

      const chain = RETAIL_CHAINS.find((c) => c.match.test(rawName));
      const kind: NearbyAtm['kind'] = shop || chain ? 'retail'
        : amenity === 'atm' ? 'atm'
        : 'bank';

      out.push({
        id: `${el.type}/${el.id}`,
        name: chain?.canonical ?? rawName,
        kind,
        address: composeAddress(tags),
        distanceMeters: haversine(lat, lon, p.lat, p.lon),
        lat: p.lat,
        lon: p.lon,
        feeCentsEstimate: chain ? chain.feeCents : null,
      });
    }

    // Dedupe: Overpass often returns a node + the surrounding way for the
    // same store. Round coords to 4 decimals (~11m) as the dedupe key.
    const seen = new Set<string>();
    const deduped: NearbyAtm[] = [];
    out
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .forEach((row) => {
        const key = `${row.name.toLowerCase()}:${row.lat.toFixed(4)}:${row.lon.toFixed(4)}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(row);
      });

    return deduped;
  }
}

// ─── Foursquare shapes (minimal projection) ───────────────────────────────

interface FoursquarePlace {
  fsq_id: string;
  name: string;
  distance?: number;
  /** Some Foursquare endpoints expose lat/lon directly on the place. */
  latitude?: number;
  longitude?: number;
  categories?: { id: number; name: string }[];
  geocodes?: { main?: { latitude: number; longitude: number } };
  location?: {
    address?: string;
    locality?: string;
    region?: string;
    postcode?: string;
    formatted_address?: string;
  };
}

function formatFsqAddress(loc: FoursquarePlace['location']): string {
  if (!loc) return 'Address unavailable';
  if (loc.formatted_address) return loc.formatted_address;
  const parts = [loc.address, loc.locality].filter(Boolean);
  return parts.join(', ') || 'Address unavailable';
}

function pointOf(el: OverpassElement): { lat: number; lon: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lon: el.lon };
  if (el.center) return el.center;
  return null;
}

function composeAddress(tags: Record<string, string>): string {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
  ]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join(', ');
  return tags['addr:full'] ?? 'Address unavailable';
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
