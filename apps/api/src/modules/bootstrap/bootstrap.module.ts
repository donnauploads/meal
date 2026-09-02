import { Module } from '@nestjs/common';
import { BootstrapSeedService } from './bootstrap-seed.service';

/**
 * Runs the env-driven baseline seed (one admin + one customer) on startup.
 * PrismaService, Argon2Service and ConfigService are all global, so no imports
 * are needed here.
 */
@Module({
  providers: [BootstrapSeedService],
})
export class BootstrapModule {}
