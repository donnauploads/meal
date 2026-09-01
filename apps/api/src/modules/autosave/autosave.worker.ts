import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AutosaveService } from './autosave.service';

@Injectable()
export class AutosaveWeeklyWorker {
  private readonly logger = new Logger(AutosaveWeeklyWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autosave: AutosaveService,
  ) {}

  @Cron('0 8 * * *', { name: 'autosave-weekly' })
  async run() {
    const today = new Date().getUTCDay();
    const configs = await this.prisma.autosaveConfig.findMany({
      where: { enabled: true, weeklyDay: today },
    });
    if (!configs.length) return;
    this.logger.log(`Autosave: ${configs.length} configs due today`);
    for (const c of configs) {
      await this.autosave.applyWeeklyContribution(c);
    }
  }
}
