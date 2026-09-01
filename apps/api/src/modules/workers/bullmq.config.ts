import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DynamicModule } from '@nestjs/common';

export const QUEUE_NAMES = {
  TransferSettlement: 'transfer-settlement',
  RecurringScan: 'recurring-scan',
} as const;

export function buildBullMQRootModule(): DynamicModule {
  return BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const url = new URL(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');

      // ioredis reads all of this straight from a URL string, but BullMQ needs
      // a plain options object — so we unpack the URL by hand and must re-apply
      // the pieces that matter for hosted Redis (the bare host/port/user/pass
      // parse alone silently breaks against every managed provider):
      //   • scheme → TLS: `rediss://` (Redis Cloud, Upstash) needs `tls`, else
      //     it opens a plaintext socket the server drops and workers hang.
      //   • credentials are percent-encoded in a URL; decode them or a
      //     generated secret containing / + @ = fails auth with WRONGPASS.
      //   • family: Railway's private network (*.railway.internal) is IPv6-only
      //     and ioredis defaults to IPv4 — honor `?family=` and default to 0
      //     (dual-stack) for railway.internal hosts so the workers can resolve.
      const isTls = url.protocol === 'rediss:';
      const familyParam = url.searchParams.get('family');
      const family = familyParam
        ? Number(familyParam)
        : url.hostname.endsWith('.railway.internal')
          ? 0
          : undefined;

      return {
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          username: url.username ? decodeURIComponent(url.username) : undefined,
          password: url.password ? decodeURIComponent(url.password) : undefined,
          ...(family !== undefined ? { family } : {}),
          ...(isTls ? { tls: { servername: url.hostname } } : {}),
        },
        prefix: config.get<string>('BULL_QUEUE_PREFIX') ?? 'bank-demo',
      };
    },
  });
}

export function registerQueues(...names: string[]): DynamicModule {
  return BullModule.registerQueue(...names.map((name) => ({ name })));
}
