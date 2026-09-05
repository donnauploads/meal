import type { GeoLocation } from './maxmind.adapter';

/**
 * A pluggable geolocation source. `lookup` is async so an HTTP-backed provider
 * (e.g. IPinfo) fits the same contract as the local MaxMind DB. Implementations
 * must never throw — return `{}` when a location can't be determined.
 */
export interface GeoipAdapter {
  lookup(ip: string): Promise<GeoLocation>;
}

export const GEOIP_ADAPTER = Symbol('GEOIP_ADAPTER');
