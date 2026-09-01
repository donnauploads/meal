import { Injectable } from '@nestjs/common';
import { GeoLocation, MaxmindAdapter } from './maxmind.adapter';

@Injectable()
export class GeoipService {
  constructor(private readonly adapter: MaxmindAdapter) {}

  resolve(ip: string): GeoLocation {
    if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
      return {};
    }
    return this.adapter.lookup(ip);
  }
}
