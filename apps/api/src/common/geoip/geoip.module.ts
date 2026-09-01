import { Global, Module } from '@nestjs/common';
import { GeoipService } from './geoip.service';
import { MaxmindAdapter } from './maxmind.adapter';

@Global()
@Module({
  providers: [MaxmindAdapter, GeoipService],
  exports: [GeoipService],
})
export class GeoipModule {}
