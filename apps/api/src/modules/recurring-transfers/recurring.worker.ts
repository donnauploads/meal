import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RecurringTransfersService } from './recurring-transfers.service';

@Injectable()
export class RecurringScanWorker implements OnModuleInit {
  private readonly logger = new Logger(RecurringScanWorker.name);
  private readonly cron: string;

  constructor(
    private readonly recurring: RecurringTransfersService,
    config: ConfigService,
  ) {
    this.cron = config.get<string>('RECURRING_SCAN_CRON') ?? '0 * * * *';
  }

  onModuleInit() {
    this.logger.log(`Recurring scan scheduled: ${this.cron}`);
  }

  @Cron('0 * * * *', { name: 'recurring-scan' })
  async run() {
    const count = await this.recurring.runDueNow();
    if (count > 0) this.logger.log(`Recurring scan triggered ${count} transfers`);
  }
}
