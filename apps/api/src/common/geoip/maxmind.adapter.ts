import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CityResponse, Reader, open } from 'maxmind';

export interface GeoLocation {
  city?: string;
  region?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, e.g. "US". Used to render flag emoji client-side. */
  countryCode?: string;
  lat?: number;
  lng?: number;
}

@Injectable()
export class MaxmindAdapter implements OnModuleInit {
  private readonly logger = new Logger(MaxmindAdapter.name);
  private reader?: Reader<CityResponse>;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const path = this.config.get<string>('GEOIP_MMDB_PATH');
    if (!path) {
      this.logger.warn('GEOIP_MMDB_PATH not set; geo enrichment will return empty.');
      return;
    }
    try {
      this.reader = await open<CityResponse>(path);
      this.logger.log(`GeoIP DB loaded from ${path}`);
    } catch (err) {
      this.logger.warn(`Failed to load GeoIP DB: ${(err as Error).message}`);
    }
  }

  lookup(ip: string): GeoLocation {
    if (!this.reader) return {};
    try {
      const r = this.reader.get(ip);
      if (!r) return {};
      return {
        city: r.city?.names?.en,
        region: r.subdivisions?.[0]?.names?.en,
        country: r.country?.names?.en,
        countryCode: r.country?.iso_code,
        lat: r.location?.latitude,
        lng: r.location?.longitude,
      };
    } catch {
      return {};
    }
  }
}
