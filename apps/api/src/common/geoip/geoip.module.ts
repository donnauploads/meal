import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeoipService } from './geoip.service';
import { MaxmindAdapter } from './maxmind.adapter';
import { IpinfoAdapter } from './ipinfo.adapter';
import { GEOIP_ADAPTER, GeoipAdapter } from './geoip.adapter';

/**
 * Picks the geolocation provider at boot:
 *   GEOIP_PROVIDER=ipinfo    → IPinfo HTTPS API (better free accuracy; needs
 *                              IPINFO_TOKEN for the 50k/mo quota).
 *   GEOIP_PROVIDER=maxmind   → local MaxMind GeoLite2 DB (default).
 *   <unset>                  → auto: IPinfo if IPINFO_TOKEN is present, else MaxMind.
 */
@Global()
@Module({
  providers: [
    MaxmindAdapter,
    IpinfoAdapter,
    {
      provide: GEOIP_ADAPTER,
      inject: [ConfigService, MaxmindAdapter, IpinfoAdapter],
      useFactory: (
        config: ConfigService,
        maxmind: MaxmindAdapter,
        ipinfo: IpinfoAdapter,
      ): GeoipAdapter => {
        const logger = new Logger('GeoipModule');
        const explicit = (config.get<string>('GEOIP_PROVIDER') ?? '')
          .trim()
          .toLowerCase();
        const hasToken = !!config.get<string>('IPINFO_TOKEN');
        const pick = explicit || (hasToken ? 'ipinfo' : 'maxmind');
        if (pick === 'ipinfo') {
          if (!hasToken) {
            logger.warn(
              'GEOIP_PROVIDER=ipinfo but IPINFO_TOKEN not set — using IPinfo unauthenticated (low daily limit).',
            );
          }
          logger.log('Using IPinfo HTTPS geolocation provider.');
          return ipinfo;
        }
        logger.log('Using MaxMind local GeoIP database.');
        return maxmind;
      },
    },
    GeoipService,
  ],
  exports: [GeoipService],
})
export class GeoipModule {}
