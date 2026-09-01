import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RoundUpsService } from './round-ups.service';

@Injectable()
export class RoundUpsDailyWorker {
  private readonly logger = new Logger(RoundUpsDailyWorker.name);

  constructor(private readonly svc: RoundUpsService) {}

  @Cron('0 4 * * *', { name: 'roundups-daily' })
  async run() {
    const { users, totalCents } = await this.svc.applyDaily();
    if (users > 0) this.logger.log(`Round-ups: applied ${totalCents.toString()} cents across ${users} users`);
  }
}
