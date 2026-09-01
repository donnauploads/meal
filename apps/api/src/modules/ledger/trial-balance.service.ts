import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

interface TrialBalanceRow {
  code: string;
  type: string;
  debits: bigint;
  credits: bigint;
}

@Injectable()
export class TrialBalanceService {
  private readonly logger = new Logger(TrialBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'trial-balance' })
  async daily(): Promise<void> {
    const result = await this.computeAndReport();
    this.logger.log(`Trial balance: ${result.balanced ? 'OK' : 'DRIFT'} (delta=${result.delta})`);
  }

  async computeAndReport(): Promise<{ balanced: boolean; delta: bigint; rows: TrialBalanceRow[] }> {
    const rows = await this.prisma.$queryRawUnsafe<TrialBalanceRow[]>(
      `SELECT la.code, la.type::text AS type,
              COALESCE(SUM(CASE WHEN p.direction = 'debit'  THEN p."amountCents" ELSE 0 END), 0)::bigint AS debits,
              COALESCE(SUM(CASE WHEN p.direction = 'credit' THEN p."amountCents" ELSE 0 END), 0)::bigint AS credits
       FROM "LedgerAccount" la
       LEFT JOIN "Posting" p ON p."ledgerAccountId" = la.id
       GROUP BY la.code, la.type
       ORDER BY la.code`,
    );
    let totalDebits = 0n;
    let totalCredits = 0n;
    for (const r of rows) {
      totalDebits += BigInt(r.debits);
      totalCredits += BigInt(r.credits);
    }
    const delta = totalDebits - totalCredits;
    return { balanced: delta === 0n, delta, rows };
  }
}
