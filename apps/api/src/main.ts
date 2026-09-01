// MUST be first: resolves DATABASE_URL/DIRECT_URL from DB_TARGET before the
// ConfigModule or Prisma client read them.
import './bootstrap-db-target';
import 'reflect-metadata';
import { setDefaultResultOrder } from 'dns';
// Node 17+ defaults to 'verbatim' DNS results — prefer IPv4 when both
// records come back (broken IPv6 egress is common on home Wi-Fi/tunnels).
setDefaultResultOrder('ipv4first');
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser = require('cookie-parser');
import morgan = require('morgan');
import { json, urlencoded, raw } from 'express';
import { resolve } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { STORAGE_DRIVER, StorageDriver } from './modules/documents/storage/storage.interface';

// Content-type for the /storage proxy, guessed from the key's extension.
function mimeFromKey(key: string): string {
  switch (key.split('.').pop()?.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Disable Nest's built-in body parser so the manual parsers below own the
    // middleware order. This is what lets the Resend webhook route receive a
    // RAW Buffer (for Svix signature verification) while every other route
    // still gets JSON — otherwise Nest's parser pre-empts the raw middleware
    // and the "raw" body arrives already-parsed, breaking verification.
    bodyParser: false,
  });
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/(.*)'],
  });
  const config = app.get(ConfigService);

  // Morgan: one line per request → "POST /api/v1/auth/login 200 42ms - 184b".
  // `dev` color-codes the status. Health probes are too chatty for the demo
  // log stream, so we skip them.
  const httpLog = new Logger('HTTP');
  app.use(
    morgan('dev', {
      skip: (req) => req.url?.startsWith('/health') ?? false,
      stream: { write: (line) => httpLog.log(line.trim()) },
    }),
  );

  // The Resend inbound webhook needs the RAW request body so its Svix
  // signature can be verified before we trust the payload. Register a raw
  // parser scoped to that one path BEFORE the JSON parser — express sets
  // `req._body` so the json() below skips re-parsing it.
  app.use('/api/v1/webhooks/resend/inbound', raw({ type: '*/*', limit: '25mb' }));

  // Raise the default body-parser limits. Multipart uploads bypass these
  // (multer handles them per-route), but JSON bodies on otherwise-quiet
  // endpoints can occasionally exceed Express's 100kb default — e.g. a
  // bulky details payload or an admin batch action. 25mb covers it.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  app.use(cookieParser());

  // CORS_ORIGIN supports a comma-separated allowlist. When the value is
  // "*" (or unset and we're not in production), reflect the request
  // origin so dev tunnels work without per-host config. `credentials:true`
  // means we can never send literal "*" — `origin: true` reflects, which
  // is what we want for non-production dev.
  const corsOrigin = config.get<string>('CORS_ORIGIN');
  const isProd = config.get<string>('NODE_ENV') === 'production';
  let corsOriginValue: boolean | string[];
  if (!corsOrigin || corsOrigin === '*') {
    corsOriginValue = !isProd; // reflect in dev, refuse cross-origin in prod
  } else {
    corsOriginValue = corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  }
  app.enableCors({
    origin: corsOriginValue,
    credentials: true,
  });

  // Serve user-uploaded assets (avatars, KYC docs) over HTTP. The
  // filesystem storage driver writes under STORAGE_FS_ROOT and reports a
  // PUBLIC_BASE-prefixed URL; this mount makes that URL resolvable.
  // Production deployments will swap to S3 + presigned URLs and this
  // mount becomes a no-op (files never live on the API server).
  const storageRoot = resolve(
    config.get<string>('STORAGE_FS_ROOT') ?? './tooling/storage',
  );
  app.useStaticAssets(storageRoot, {
    prefix: '/storage/',
    // 1-day cache is fine — avatar filenames are immutable UUIDs.
    maxAge: 86_400_000,
    setHeaders: (res) => {
      // Allow <img src> + canvas use across origins (e.g. when the
      // frontend tunnel host loads images from this backend).
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  // Object-storage proxy for the S3 driver. When STORAGE_DRIVER=s3 the files
  // live in the bucket, not on this server's disk, so the static mount above
  // calls next() and this handler streams the object via an authenticated
  // server-side GET. This is required for Neon storage, which rejects SigV4
  // presigned URLs (403) — the S3 driver's getPresignedDownloadUrl now points
  // here. On the filesystem driver this never runs (static serves the file).
  const storage = app.get<StorageDriver>(STORAGE_DRIVER);
  app.getHttpAdapter().getInstance().get(/^\/storage\/(.+)/, (req, res) => {
    const key = decodeURIComponent(req.params[0]);
    storage
      .get(key)
      .then((buf) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type(mimeFromKey(key));
        res.end(buf);
      })
      .catch(() => res.status(404).end());
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  const port = Number(config.get<string>('PORT') ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on :${port}`);
}

bootstrap();
