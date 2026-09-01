export interface StoragePutInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageDriver {
  put(input: StoragePutInput): Promise<{ key: string }>;
  get(key: string): Promise<Buffer>;
  getPresignedDownloadUrl(key: string, ttlSec?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
