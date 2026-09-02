import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

// Evaluated at module load. `process.env` is the reliable source for the
// schedule at decoration time (platform env on Railway, or an exported var);
// the default is a sane every-6-hours. Enable/disable + URLs are read at
// runtime from ConfigService below.
const BACKUP_CRON = process.env.BACKUP_CRON || '0 */6 * * *';

const DUMP_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Periodic logical backup: pg_dump the primary database and restore the dump
 * into a separate backup database (e.g. local Postgres → Neon), on a schedule.
 *
 *   BACKUP_ENABLED=true
 *   BACKUP_TARGET_URL=<backup DB, e.g. Neon DIRECT url>   ← must be reachable + DDL-capable
 *   BACKUP_SOURCE_URL=<primary>   (optional; defaults to DIRECT_URL/DATABASE_URL)
 *   BACKUP_CRON=<cron expression> (optional; default every 6 hours)
 *
 * REQUIRES the Postgres client tools (`pg_dump`, `psql`) on PATH in the
 * runtime, at a major version >= the servers. This is why it only makes sense
 * where you control the box (local dev / VPS), not a stock managed container.
 * Failures are logged, never fatal; runs never overlap.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly enabled: boolean;
  private readonly sourceUrl: string;
  private readonly targetUrl: string;
  private running = false;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('BACKUP_ENABLED') === true;
    this.targetUrl = (config.get<string>('BACKUP_TARGET_URL') ?? '').trim();
    this.sourceUrl = (
      config.get<string>('BACKUP_SOURCE_URL') ||
      config.get<string>('DIRECT_URL') ||
      config.get<string>('DATABASE_URL') ||
      ''
    ).trim();

    if (this.enabled) {
      this.logger.log(
        `DB backup enabled (schedule "${BACKUP_CRON}") → ${redactUrl(this.targetUrl)}`,
      );
    }
  }

  @Cron(BACKUP_CRON, { name: 'db-backup' })
  async runBackup(): Promise<void> {
    if (!this.enabled) return;
    if (!this.targetUrl || !this.sourceUrl) {
      this.logger.warn(
        'DB backup skipped: BACKUP_TARGET_URL and/or a resolvable source URL are not set.',
      );
      return;
    }
    if (this.running) {
      this.logger.warn('DB backup skipped: a previous run is still in progress.');
      return;
    }

    this.running = true;
    const started = Date.now();
    const file = join(tmpdir(), `db-backup-${Date.now()}.sql`);
    try {
      // Plain-SQL dump with DROP ... IF EXISTS so the target is fully
      // refreshed each run (a snapshot, not an append).
      await execFileAsync(
        'pg_dump',
        ['--no-owner', '--no-acl', '--clean', '--if-exists', '-f', file, this.sourceUrl],
        { timeout: DUMP_TIMEOUT_MS, windowsHide: true },
      );
      await execFileAsync(
        'psql',
        [this.targetUrl, '-v', 'ON_ERROR_STOP=1', '-f', file],
        { timeout: DUMP_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      );
      this.logger.log(
        `DB backup complete → ${redactUrl(this.targetUrl)} in ${(
          (Date.now() - started) / 1000
        ).toFixed(1)}s`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      const hint = /ENOENT/.test(msg)
        ? ' (pg_dump/psql not found on PATH — install the Postgres client tools)'
        : '';
      this.logger.error(`DB backup failed${hint}: ${msg}`);
    } finally {
      await unlink(file).catch(() => undefined);
      this.running = false;
    }
  }
}

/** Hide credentials when logging a connection URL. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//***@${u.host}${u.pathname}`;
  } catch {
    return '<invalid url>';
  }
}
