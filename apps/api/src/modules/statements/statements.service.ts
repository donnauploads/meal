import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Statement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from '../documents/storage/storage.interface';
import { StatementRenderer } from './statement.renderer';

function startOfPriorMonthUTC(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end };
}

@Injectable()
export class StatementsService {
  private readonly logger = new Logger(StatementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly renderer: StatementRenderer,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 5 1 * *', { name: 'monthly-statements' })
  async monthlyRun() {
    const { start, end } = startOfPriorMonthUTC();
    const accounts = await this.prisma.account.findMany({
      where: { status: 'active' },
      select: { id: true, userId: true },
    });
    this.logger.log(`Monthly statements: ${accounts.length} accounts for ${start.toISOString().slice(0, 7)}`);
    for (const a of accounts) {
      try {
        await this.generateOne(a.id, start, end);
      } catch (err) {
        this.logger.warn(`statement failed for ${a.id}: ${(err as Error).message}`);
      }
    }
  }

  async generateOne(accountId: string, periodStart: Date, periodEnd: Date): Promise<Statement> {
    const existing = await this.prisma.statement.findUnique({
      where: { accountId_periodStart: { accountId, periodStart } },
    });
    if (existing) return existing;

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { user: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const transactions = await this.prisma.transaction.findMany({
      where: {
        accountId,
        status: 'posted',
        occurredAt: { gte: periodStart, lt: periodEnd },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

    const opening = await this.balanceAt(accountId, periodStart);
    let running = opening;
    let totalIn = 0n;
    let totalOut = 0n;
    const rows = transactions.map((t) => {
      running += t.amountCents;
      if (t.amountCents > 0n) totalIn += t.amountCents;
      else totalOut += -t.amountCents;
      return {
        occurredAt: t.occurredAt,
        description: t.description,
        amountCents: t.amountCents,
        runningBalanceCents: running,
      };
    });

    const pdf = await this.renderer.render({
      accountLabel: account.label,
      accountNumberMasked: `••••${account.mockAccountNumber.slice(-4)}`,
      routingNumber: account.mockRoutingNumber,
      userFullName: [account.user.firstName, account.user.lastName].filter(Boolean).join(' ') || account.user.email,
      periodStart,
      periodEnd: new Date(periodEnd.getTime() - 1),
      openingBalanceCents: opening,
      closingBalanceCents: running,
      totalInCents: totalIn,
      totalOutCents: totalOut,
      transactions: rows,
    });

    const key = `statements/${account.userId}/${accountId}/${periodStart.toISOString().slice(0, 7)}.pdf`;
    await this.storage.put({ key, body: pdf, contentType: 'application/pdf' });

    return this.prisma.statement.create({
      data: { accountId, periodStart, periodEnd, storageKey: key, sizeBytes: pdf.length },
    });
  }

  /**
   * Re-render every stored statement with the current renderer and overwrite
   * the PDF in place (same storageKey), so existing download URLs serve the
   * up-to-date branding. Used after a renderer/brand change. One-shot —
   * invoke from scripts/regenerate-statements.ts.
   */
  async regenerateAllStored(): Promise<{ regenerated: number; failed: number }> {
    const rows = await this.prisma.statement.findMany();
    let regenerated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const account = await this.prisma.account.findUnique({
          where: { id: row.accountId },
          include: { user: true },
        });
        if (!account) {
          failed++;
          continue;
        }
        const periodStart = row.periodStart;
        const periodEnd = row.periodEnd; // exclusive end, as stored
        const transactions = await this.prisma.transaction.findMany({
          where: {
            accountId: row.accountId,
            status: 'posted',
            occurredAt: { gte: periodStart, lt: periodEnd },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        });
        const opening = await this.balanceAt(row.accountId, periodStart);
        let running = opening;
        let totalIn = 0n;
        let totalOut = 0n;
        const txRows = transactions.map((t) => {
          running += t.amountCents;
          if (t.amountCents > 0n) totalIn += t.amountCents;
          else totalOut += -t.amountCents;
          return {
            occurredAt: t.occurredAt,
            description: t.description,
            amountCents: t.amountCents,
            runningBalanceCents: running,
          };
        });
        const pdf = await this.renderer.render({
          accountLabel: account.label,
          accountNumberMasked: `••••${account.mockAccountNumber.slice(-4)}`,
          routingNumber: account.mockRoutingNumber,
          userFullName:
            [account.user.firstName, account.user.lastName].filter(Boolean).join(' ') ||
            account.user.email,
          periodStart,
          periodEnd: new Date(periodEnd.getTime() - 1),
          openingBalanceCents: opening,
          closingBalanceCents: running,
          totalInCents: totalIn,
          totalOutCents: totalOut,
          transactions: txRows,
        });
        await this.storage.put({
          key: row.storageKey,
          body: pdf,
          contentType: 'application/pdf',
        });
        await this.prisma.statement.update({
          where: { id: row.id },
          data: { sizeBytes: pdf.length },
        });
        regenerated++;
      } catch (e) {
        this.logger.warn(`regenerate statement ${row.id} failed: ${(e as Error).message}`);
        failed++;
      }
    }
    return { regenerated, failed };
  }

  async listForUser(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId }, select: { id: true, label: true } });
    const ids = accounts.map((a) => a.id);
    if (!ids.length) return [];
    const rows = await this.prisma.statement.findMany({
      where: { accountId: { in: ids } },
      orderBy: { periodStart: 'desc' },
    });
    const labelById = new Map(accounts.map((a) => [a.id, a.label]));
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      accountLabel: labelById.get(r.accountId) ?? '',
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      sizeBytes: r.sizeBytes,
      generatedAt: r.generatedAt.toISOString(),
    }));
  }

  /**
   * Render a PDF for an arbitrary [periodStart, periodEnd] range without
   * touching the Statement table — the customer Documents page calls this
   * when they want a custom-period download. periodEnd is inclusive.
   */
  async renderCustom(
    userId: string,
    accountId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ pdf: Buffer; filename: string }> {
    if (!(periodStart instanceof Date) || isNaN(periodStart.getTime())) {
      throw new BadRequestException('PERIOD_START_INVALID');
    }
    if (!(periodEnd instanceof Date) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('PERIOD_END_INVALID');
    }
    if (periodEnd <= periodStart) {
      throw new BadRequestException('PERIOD_RANGE_INVALID');
    }
    const oneYearMs = 366 * 24 * 60 * 60 * 1000;
    if (periodEnd.getTime() - periodStart.getTime() > oneYearMs) {
      throw new BadRequestException('PERIOD_TOO_WIDE');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { user: true },
    });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Account not found');
    }

    // periodEnd is inclusive at the day level — bump to end of that UTC day.
    const endExclusive = new Date(
      Date.UTC(
        periodEnd.getUTCFullYear(),
        periodEnd.getUTCMonth(),
        periodEnd.getUTCDate() + 1,
      ),
    );

    const transactions = await this.prisma.transaction.findMany({
      where: {
        accountId,
        status: 'posted',
        occurredAt: { gte: periodStart, lt: endExclusive },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

    const opening = await this.balanceAt(accountId, periodStart);
    let running = opening;
    let totalIn = 0n;
    let totalOut = 0n;
    const rows = transactions.map((t) => {
      running += t.amountCents;
      if (t.amountCents > 0n) totalIn += t.amountCents;
      else totalOut += -t.amountCents;
      return {
        occurredAt: t.occurredAt,
        description: t.description,
        amountCents: t.amountCents,
        runningBalanceCents: running,
      };
    });

    const pdf = await this.renderer.render({
      accountLabel: account.label,
      accountNumberMasked: `••••${account.mockAccountNumber.slice(-4)}`,
      routingNumber: account.mockRoutingNumber,
      userFullName:
        [account.user.firstName, account.user.lastName].filter(Boolean).join(' ') ||
        account.user.email,
      periodStart,
      periodEnd,
      openingBalanceCents: opening,
      closingBalanceCents: running,
      totalInCents: totalIn,
      totalOutCents: totalOut,
      transactions: rows,
    });

    const slug = account.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
    const filename = `State Bank-Statement-${slug}-${periodStart.toISOString().slice(0, 10)}_to_${periodEnd.toISOString().slice(0, 10)}.pdf`;
    return { pdf, filename };
  }

  async downloadUrl(userId: string, id: string): Promise<string> {
    const row = await this.prisma.statement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Statement not found');
    const account = await this.prisma.account.findUnique({ where: { id: row.accountId } });
    if (!account || account.userId !== userId) throw new NotFoundException('Statement not found');
    return this.storage.getPresignedDownloadUrl(row.storageKey);
  }

  private async balanceAt(accountId: string, atOrBefore: Date): Promise<bigint> {
    const agg = await this.prisma.transaction.aggregate({
      where: { accountId, status: 'posted', occurredAt: { lt: atOrBefore } },
      _sum: { amountCents: true },
    });
    return BigInt(agg._sum.amountCents ?? 0n);
  }
}
