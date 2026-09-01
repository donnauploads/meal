import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Public } from '../modules/auth/decorators/public.decorator';
import { redisFamilyOption } from '../common/redis-family.util';

@Controller('health')
@Public()
export class HealthController {
  private prisma?: PrismaClient;
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {}

  @Get('liveness')
  liveness() {
    return { ok: true };
  }

  @Get('readiness')
  async readiness() {
    const checks: Record<string, 'up' | 'down'> = { postgres: 'down', redis: 'down' };

    try {
      this.prisma ??= new PrismaClient({ datasources: { db: { url: this.config.get<string>('DATABASE_URL')! } } });
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'up';
    } catch {
      // leave as down
    }

    try {
      const redisUrl = this.config.get<string>('REDIS_URL')!;
      this.redis ??= new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, ...redisFamilyOption(redisUrl) });
      if (this.redis.status !== 'ready') await this.redis.connect().catch(() => undefined);
      const pong = await this.redis.ping();
      checks.redis = pong === 'PONG' ? 'up' : 'down';
    } catch {
      // leave as down
    }

    const ok = checks.postgres === 'up' && checks.redis === 'up';
    if (!ok) throw new ServiceUnavailableException({ ok: false, checks });
    return { ok: true, checks };
  }
}
