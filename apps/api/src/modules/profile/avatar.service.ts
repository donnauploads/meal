import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from '../documents/storage/storage.interface';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    config: ConfigService,
  ) {
    this.maxBytes = Number(config.get('AVATAR_MAX_BYTES') ?? 5 * 1024 * 1024);
  }

  async remove(userId: string): Promise<void> {
    // We only persist the public/presigned URL on the user row, not the
    // underlying storage key, so the storage object is intentionally
    // orphaned here. Cleaning it up would require tracking the key as
    // well — out of scope for this demo.
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  }

  async upload(userId: string, file: { mimetype: string; buffer: Buffer }): Promise<string> {
    if (!ALLOWED.has(file.mimetype)) throw new BadRequestException('Unsupported image type');
    if (file.buffer.length > this.maxBytes) throw new BadRequestException(`Avatar exceeds ${this.maxBytes} bytes`);

    const processed = await this.processIfPossible(file.buffer);
    const key = `user/${userId}/avatar/${randomUUID()}.jpg`;
    await this.storage.put({ key, body: processed.body, contentType: processed.contentType });
    const url = await this.storage.getPresignedDownloadUrl(key);
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } });
    return url;
  }

  private async processIfPossible(buf: Buffer): Promise<{ body: Buffer; contentType: string }> {
    try {
      const sharp = (await import('sharp')).default;
      const body = await sharp(buf).rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
      return { body, contentType: 'image/jpeg' };
    } catch (err) {
      this.logger.warn(`sharp unavailable, storing original: ${(err as Error).message}`);
      return { body: buf, contentType: 'image/jpeg' };
    }
  }
}
