import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RecurringFrequency, RecurringTransfer } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';

function computeNextRunAt(from: Date, frequency: RecurringFrequency, dayOf: number): Date {
  const d = new Date(from);
  if (frequency === RecurringFrequency.weekly) {
    const diff = (dayOf - d.getUTCDay() + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + diff);
  } else if (frequency === RecurringFrequency.biweekly) {
    const diff = (dayOf - d.getUTCDay() + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + diff + 7);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dayOf, lastDay));
  }
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

@Injectable()
export class RecurringTransfersService {
  private readonly logger = new Logger(RecurringTransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
  ) {}

  async create(userId: string, dto: CreateRecurringDto): Promise<RecurringTransfer> {
    const fromAcct = await this.prisma.account.findUnique({ where: { id: dto.fromAccountId } });
    const toAcct = await this.prisma.account.findUnique({ where: { id: dto.toAccountId } });
    if (!fromAcct || fromAcct.userId !== userId) throw new ForbiddenException('Not your source account');
    if (!toAcct || toAcct.userId !== userId) throw new ForbiddenException('Not your destination account');

    const nextRunAt = computeNextRunAt(new Date(), dto.frequency, dto.dayOf);
    return this.prisma.recurringTransfer.create({
      data: {
        userId,
        fromAccountId: dto.fromAccountId,
        toAccountId: dto.toAccountId,
        amountCents: dto.amountCents,
        frequency: dto.frequency,
        dayOf: dto.dayOf,
        nextRunAt,
      },
    });
  }

  list(userId: string) {
    return this.prisma.recurringTransfer.findMany({ where: { userId }, orderBy: { nextRunAt: 'asc' } });
  }

  async update(userId: string, id: string, dto: UpdateRecurringDto): Promise<RecurringTransfer> {
    const existing = await this.prisma.recurringTransfer.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Recurring not found');

    // When frequency or dayOf changes, recompute nextRunAt from `now` so
    // the schedule is honored from the edit forward — otherwise a user
    // changing "every Monday" to "every Friday" would still fire on the
    // already-stored Monday.
    const nextFrequency = dto.frequency ?? existing.frequency;
    const nextDayOf = dto.dayOf ?? existing.dayOf;
    const scheduleChanged =
      dto.frequency !== undefined && dto.frequency !== existing.frequency
        ? true
        : dto.dayOf !== undefined && dto.dayOf !== existing.dayOf;

    return this.prisma.recurringTransfer.update({
      where: { id },
      data: {
        active: dto.active ?? undefined,
        amountCents: dto.amountCents ?? undefined,
        frequency: dto.frequency ?? undefined,
        dayOf: dto.dayOf ?? undefined,
        nextRunAt: scheduleChanged
          ? computeNextRunAt(new Date(), nextFrequency, nextDayOf)
          : undefined,
      },
    });
  }

  /**
   * Hard-delete the row. The customer UI's trash button expects the
   * schedule to disappear from the list — not be quietly soft-paused.
   * Use the PATCH endpoint with `{active:false}` for pause/resume.
   */
  async cancel(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.recurringTransfer.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Recurring not found');
    await this.prisma.recurringTransfer.delete({ where: { id } });
  }

  async runDueNow(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.recurringTransfer.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      take: 100,
    });
    let count = 0;
    for (const r of due) {
      try {
        await this.transfers.initiate(r.userId, `recurring:${r.id}:${r.nextRunAt.toISOString()}`, {
          fromAccountId: r.fromAccountId,
          toAccountId: r.toAccountId,
          kind: 'internal',
          amountCents: r.amountCents,
          instant: false,
          note: 'Recurring transfer',
        });
        await this.prisma.recurringTransfer.update({
          where: { id: r.id },
          data: {
            lastRunAt: now,
            nextRunAt: computeNextRunAt(now, r.frequency, r.dayOf),
          },
        });
        count++;
      } catch (err) {
        this.logger.warn(`Recurring ${r.id} failed: ${(err as Error).message}`);
      }
    }
    return count;
  }
}

export { computeNextRunAt };
