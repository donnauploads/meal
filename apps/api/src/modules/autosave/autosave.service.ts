import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AutosaveConfig } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { UpdateAutosaveDto } from './dto/autosave.dto';
import { GoalSplit, allocateCents, normalizeSplits } from './splits.util';

@Injectable()
export class AutosaveService {
  private readonly logger = new Logger(AutosaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
  ) {}

  async get(userId: string): Promise<AutosaveConfig | null> {
    return this.prisma.autosaveConfig.findUnique({ where: { userId } });
  }

  async upsert(userId: string, dto: UpdateAutosaveDto): Promise<AutosaveConfig> {
    let normalizedSplits: GoalSplit[] | undefined;
    if (dto.splits) {
      const ownedGoals = await this.prisma.goal.findMany({
        where: { userId, id: { in: dto.splits.map((s) => s.goalId) } },
        select: { id: true },
      });
      const owned = new Set(ownedGoals.map((g) => g.id));
      for (const s of dto.splits) if (!owned.has(s.goalId)) throw new BadRequestException(`Goal not found: ${s.goalId}`);
      normalizedSplits = normalizeSplits(dto.splits);
    }

    if (dto.roundUpSourceAccountId) {
      const acct = await this.prisma.account.findUnique({ where: { id: dto.roundUpSourceAccountId } });
      if (!acct || acct.userId !== userId) throw new BadRequestException('Round-up source must be your account');
    }

    return this.prisma.autosaveConfig.upsert({
      where: { userId },
      update: {
        enabled: dto.enabled ?? undefined,
        roundUpEnabled: dto.roundUpEnabled ?? undefined,
        roundUpSourceAccountId: dto.roundUpSourceAccountId ?? undefined,
        splits: normalizedSplits ? (normalizedSplits as unknown as object) : undefined,
        weeklyContributionCents: dto.weeklyContributionCents ?? undefined,
        weeklyDay: dto.weeklyDay ?? undefined,
      },
      create: {
        userId,
        enabled: dto.enabled ?? false,
        roundUpEnabled: dto.roundUpEnabled ?? false,
        roundUpSourceAccountId: dto.roundUpSourceAccountId ?? null,
        splits: (normalizedSplits ?? []) as unknown as object,
        weeklyContributionCents: dto.weeklyContributionCents ?? null,
        weeklyDay: dto.weeklyDay ?? null,
      },
    });
  }

  async applyWeeklyContribution(config: AutosaveConfig): Promise<void> {
    if (!config.enabled || !config.weeklyContributionCents || config.weeklyContributionCents <= 0n) return;
    const splits = (config.splits as unknown as GoalSplit[]) ?? [];
    if (!splits.length) return;

    const sourceId = config.roundUpSourceAccountId
      ?? (await this.prisma.account.findFirst({
        where: { userId: config.userId, type: 'checking', status: 'active' },
        select: { id: true },
      }))?.id;
    if (!sourceId) return;

    const savings = await this.prisma.account.findFirst({
      where: { userId: config.userId, type: 'savings', status: 'active' },
    });
    if (!savings) return;

    const total = config.weeklyContributionCents;
    const idempotencyKey = `autosave:weekly:${config.userId}:${weekStamp(new Date())}`;
    try {
      await this.transfers.initiate(config.userId, idempotencyKey, {
        fromAccountId: sourceId,
        toAccountId: savings.id,
        kind: 'internal',
        amountCents: total,
        instant: false,
        note: 'Autosave weekly contribution',
      });
    } catch (err) {
      this.logger.warn(`autosave weekly transfer for ${config.userId} failed: ${(err as Error).message}`);
      return;
    }

    const allocations = allocateCents(total, splits);
    for (const a of allocations) {
      await this.prisma.goal.update({ where: { id: a.goalId }, data: { currentCents: { increment: a.cents } } });
    }
  }
}

function weekStamp(d: Date): string {
  const year = d.getUTCFullYear();
  const onejan = Date.UTC(year, 0, 1);
  const week = Math.floor(((d.getTime() - onejan) / 86400000 + new Date(onejan).getUTCDay() + 1) / 7);
  return `${year}-W${week.toString().padStart(2, '0')}`;
}
