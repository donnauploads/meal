import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { STORAGE_DRIVER } from './storage/storage.interface';
import { FilesystemStorage } from './storage/filesystem.storage';
import { S3Storage } from './storage/s3.storage';

@Global()
@Module({
  providers: [
    FilesystemStorage,
    S3Storage,
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService, FilesystemStorage, S3Storage],
      useFactory: (config: ConfigService, fs: FilesystemStorage, s3: S3Storage) =>
        (config.get<string>('STORAGE_DRIVER') ?? 'filesystem') === 's3' ? s3 : fs,
    },
    DocumentsService,
  ],
  exports: [DocumentsService, STORAGE_DRIVER],
})
export class DocumentsModule {}
