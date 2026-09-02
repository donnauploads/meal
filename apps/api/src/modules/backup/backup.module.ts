import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';

/**
 * Scheduled logical backup (pg_dump → restore into a backup DB). ConfigService
 * is global and ScheduleModule is set up in AppModule, so no imports needed.
 */
@Module({
  providers: [BackupService],
})
export class BackupModule {}
