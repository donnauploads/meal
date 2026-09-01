import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { StorageDriver, StoragePutInput } from './storage.interface';

@Injectable()
export class FilesystemStorage implements StorageDriver {
  private readonly logger = new Logger(FilesystemStorage.name);
  private readonly root: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_FS_ROOT') ?? './tooling/storage');
    void fs.mkdir(this.root, { recursive: true }).catch(() => undefined);
    // PUBLIC_BASE is the externally-reachable origin of the API server.
    // Unset (default in dev) → emit a *relative* URL (just /storage/<key>)
    // so the asset resolves against whatever origin loaded the page —
    // tunnels, localhost, and prod hosts all just work as long as the
    // frontend forwards /storage/* through to this server.
    // Set it (e.g. https://cdn.nova.com) in production to serve from a
    // CDN host directly.
    this.publicBase = (config.get<string>('PUBLIC_BASE') ?? '').replace(/\/$/, '');
    this.logger.log(
      `Filesystem storage at ${this.root} ` +
        `(served at ${this.publicBase || '<relative>'}/storage/)`,
    );
  }

  private safePath(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root)) throw new Error('Invalid storage key');
    return target;
  }

  async put({ key, body }: StoragePutInput): Promise<{ key: string }> {
    const path = this.safePath(key);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, body);
    return { key };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.safePath(key));
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    // Encode each path segment so any odd characters (spaces, unicode) in
    // the key survive being parsed as a URL — the key itself stays
    // delimited by raw "/".
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBase}/storage/${encoded}`;
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.safePath(key)).catch(() => undefined);
  }
}
