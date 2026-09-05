import { Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GeoipService } from '../../common/geoip/geoip.service';
import { computeFingerprint, parseUaSummary, FingerprintInput } from './fingerprint.util';

export interface DeviceContext {
  userId: string;
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  timezone: string;
  canvasHash?: string;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geoip: GeoipService,
  ) {}

  fingerprint(ctx: Omit<DeviceContext, 'userId' | 'ip'>): string {
    const input: FingerprintInput = {
      userAgent: ctx.userAgent,
      acceptLanguage: ctx.acceptLanguage,
      timezone: ctx.timezone,
      canvasHash: ctx.canvasHash,
    };
    return computeFingerprint(input);
  }

  async findKnown(userId: string, fingerprint: string): Promise<Device | null> {
    return this.prisma.device.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } });
  }

  async upsertOnLogin(ctx: DeviceContext): Promise<Device> {
    const fp = this.fingerprint(ctx);
    const summary = parseUaSummary(ctx.userAgent);
    const location = await this.geoip.resolve(ctx.ip);

    const existing = await this.findKnown(ctx.userId, fp);
    if (existing) {
      return this.prisma.device.update({
        where: { id: existing.id },
        data: {
          ipLastSeen: ctx.ip,
          locationLastSeen: location as object,
          lastSeenAt: new Date(),
          revokedAt: null,
        },
      });
    }
    return this.prisma.device.create({
      data: {
        userId: ctx.userId,
        fingerprint: fp,
        name: summary.name,
        os: summary.os,
        browser: summary.browser,
        ipFirstSeen: ctx.ip,
        ipLastSeen: ctx.ip,
        locationLastSeen: location as object,
        trusted: false,
      },
    });
  }

  async markTrusted(deviceId: string): Promise<void> {
    await this.prisma.device.update({ where: { id: deviceId }, data: { trusted: true } });
  }
}
