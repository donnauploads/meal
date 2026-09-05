import { Inject, Injectable } from '@nestjs/common';
import { GeoLocation } from './maxmind.adapter';
import { GEOIP_ADAPTER, GeoipAdapter } from './geoip.adapter';

@Injectable()
export class GeoipService {
  constructor(@Inject(GEOIP_ADAPTER) private readonly adapter: GeoipAdapter) {}

  /**
   * Resolve an IP to an approximate location. Private / loopback IPs short-
   * circuit to `{}` WITHOUT hitting the provider (so localhost never burns an
   * IPinfo call). Never throws — returns `{}` on any provider error.
   */
  async resolve(ip: string): Promise<GeoLocation> {
    if (
      !ip ||
      ip === '::1' ||
      ip.startsWith('127.') ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('::ffff:127.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    ) {
      return {};
    }
    try {
      return await this.adapter.lookup(ip);
    } catch {
      return {};
    }
  }
}
