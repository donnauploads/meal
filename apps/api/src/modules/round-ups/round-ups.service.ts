import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { NEST_EVENT, NestTransactionSettledPayload } from '../realtime/events';
import { GoalSplit, allocateCents } from '../autosave/splits.util';

function roundUpCents(amountAbs: bigint): bigint {
  const remainder = amountAbs % 100n;
  if (remainder === 0n) return 0n;
  return 100n - remainder;
}

@Injectable()
export class RoundUpsService {
  private readonly logger = new Logger(RoundUpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
  ) {}

  @OnEvent(NEST_EVENT.TransactionSettled)
  async onSettled(payload: NestTransactionSettledPayload) {
    try {
      const tx = await this.prisma.transaction.findUnique({ where: { id: payload.transactionId } });
      if (!tx) return;
      if (tx.kind !== 'card_purchase') return;
      if (tx.amountCents >= 0n) return;

      const config = await this.prisma.autosaveConfig.findUnique({ where: { userId: payload.userId } });
      if (!config?.enabled || !config.roundUpEnabled) return;

      const amount = -tx.amountCents;
      const ru = roundUpCents(amount);
      if (ru === 0n) return;

      await this.prisma.roundUpLedger.create({
        data: { userId: payload.userId, transactionId: tx.id, amountCents: ru },
      });
    } catch (err) {
      this.logger.warn(`round-up record failed: ${(err as Error).message}`);
    }
  }

  async applyDaily(): Promise<{ users: number; totalCents: bigint }> {
    const groups = await this.prisma.roundUpLedger.groupBy({
      by: ['userId'],
      where: { appliedAt: null },
      _sum: { amountCents: true },
    });
    let users = 0;
    let totalCents = 0n;
    for (const g of groups) {
      const sum = g._sum.amountCents ?? 0n;
      if (sum <= 0n) continue;
      const ok = await this.applyForUser(g.userId, sum);
      if (ok) {
        users++;
        totalCents += sum;
      }
    }
    return { users, totalCents };
  }

  private async applyForUser(userId: string, total: bigint): Promise<boolean> {
    const config = await this.prisma.autosaveConfig.findUnique({ where: { userId } });
    if (!config?.enabled || !config.roundUpEnabled) return false;
    const sourceId = config.roundUpSourceAccountId
      ?? (await this.prisma.account.findFirst({
        where: { userId, type: 'checking', status: 'active' },
        select: { id: true },
      }))?.id;
    if (!sourceId) return false;

    const savings = await this.prisma.account.findFirst({
      where: { userId, type: 'savings', status: 'active' },
    });
    if (!savings) return false;

    const splits = (config.splits as unknown as GoalSplit[]) ?? [];
    const idempotencyKey = `roundup:${userId}:${new Date().toISOString().slice(0, 10)}`;
    try {
      await this.transfers.initiate(userId, idempotencyKey, {
        fromAccountId: sourceId,
        toAccountId: savings.id,
        kind: 'internal',
        amountCents: total,
        instant: false,
        note: 'Round-up sweep',
      });
    } catch (err) {
      this.logger.warn(`round-up transfer failed for ${userId}: ${(err as Error).message}`);
      return false;
    }

    if (splits.length) {
      const allocations = allocateCents(total, splits);
      for (const a of allocations) {
        await this.prisma.goal.update({ where: { id: a.goalId }, data: { currentCents: { increment: a.cents } } });
      }
    }
    await this.prisma.roundUpLedger.updateMany({
      where: { userId, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    return true;
  }
}

export { roundUpCents };
