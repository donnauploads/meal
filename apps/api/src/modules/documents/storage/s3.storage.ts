import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageDriver, StoragePutInput } from './storage.interface';

@Injectable()
export class S3Storage implements StorageDriver {
  private readonly logger = new Logger(S3Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('STORAGE_S3_BUCKET') ?? '';
    this.publicBase = (config.get<string>('PUBLIC_BASE') ?? '').replace(/\/$/, '');
    this.client = new S3Client({
      region: config.get<string>('STORAGE_S3_REGION') ?? 'us-east-1',
      endpoint: config.get<string>('STORAGE_S3_ENDPOINT') || undefined,
      forcePathStyle: Boolean(config.get<boolean>('STORAGE_S3_FORCE_PATH_STYLE')),
      credentials: config.get<string>('STORAGE_S3_ACCESS_KEY')
        ? {
            accessKeyId: config.get<string>('STORAGE_S3_ACCESS_KEY')!,
            secretAccessKey: config.get<string>('STORAGE_S3_SECRET_KEY') ?? '',
          }
        : undefined,
    });
  }

  async put({ key, body, contentType }: StoragePutInput): Promise<{ key: string }> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return { key };
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return streamToBuffer(out.Body as Readable);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPresignedDownloadUrl(key: string, _ttlSec = 900): Promise<string> {
    // Neon's S3-compatible storage rejects SigV4 query-string presigned
    // URLs (they 403 with AccessDenied) even though authenticated
    // server-side GETs succeed. So instead of handing the browser a direct
    // bucket URL, we serve every object through this API's own
    // `/storage/<key>` route, which streams the bytes via an authenticated
    // GET (see main.ts). Same URL shape the filesystem driver emits, so the
    // frontend needs no changes. Unset PUBLIC_BASE → relative URL, which
    // resolves against whatever origin loaded the page.
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBase}/storage/${encoded}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
