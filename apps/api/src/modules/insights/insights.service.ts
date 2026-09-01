import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import {
  NEST_EVENT,
  NestAccountBalanceChangedPayload,
  NestTransactionCreatedPayload,
  NestTransactionSettledPayload,
  NestTransactionUpdatedPayload,
} from '../realtime/events';

export interface MonthlyTotals {
  yearMonth: string;
  monthStart: string;
  totalInCents: string;
  totalOutCents: string;
  txCount: number;
}

export interface CategoryTotals {
  monthStart: string;
  category: string;
  totalSpentCents: string;
  txCount: number;
}

interface MonthlyRow {
  year_month: string;
  month_start: Date;
  total_in_cents: bigint;
  total_out_cents: bigint;
  tx_count: bigint;
}

interface CategoryRow {
  month_start: Date;
  category: string;
  total_spent_cents: bigint;
  tx_count: bigint;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly cacheTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    config: ConfigService,
  ) {
    // Default 30s — short enough that even if event-based invalidation
    // misses (Redis hiccup, missing emitter), a stale chart only lasts
    // half a minute. Live aggregate is fast enough this is fine.
    this.cacheTtl = Number(config.get('INSIGHTS_CACHE_TTL_SEC') ?? 30);
  }

  // ─── Cache invalidation ─────────────────────────────────────────────
  //
  // Any change to a user's transactions or balances drops every
  // `insights:*:${userId}:*` key so the next chart fetch reflects the
  // change immediately. Without this the customer had to wait up to
  // the full TTL (was 300s) before a fresh transfer showed up — which
  // reads as "Insights are wrong" even though the math will eventually
  // catch up.

  @OnEvent(NEST_EVENT.TransactionCreated)
  onTransactionCreated(p: NestTransactionCreatedPayload) {
    void this.invalidateForUser(p.userId);
  }

  @OnEvent(NEST_EVENT.TransactionSettled)
  onTransactionSettled(p: NestTransactionSettledPayload) {
    void this.invalidateForUser(p.userId);
  }

  @OnEvent(NEST_EVENT.TransactionUpdated)
  onTransactionUpdated(p: NestTransactionUpdatedPayload) {
    void this.invalidateForUser(p.userId);
  }

  @OnEvent(NEST_EVENT.AccountBalanceChanged)
  onAccountBalanceChanged(p: NestAccountBalanceChangedPayload) {
    // Balance changes (transfers, reversals, admin overrides) imply a
    // transaction landed even if the worker emits the events in a
    // different order, so include this as a safety net.
    void this.invalidateForUser(p.userId);
  }

  private async invalidateForUser(userId: string): Promise<void> {
    try {
      await this.cache.delByPattern(`insights:*:${userId}:*`);
    } catch (err) {
      this.logger.warn(
        `insights cache invalidation failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  async monthly(userId: string, accountId?: string, months = 12): Promise<MonthlyTotals[]> {
    const accountIds = await this.resolveAccountIds(userId, accountId);
    if (!accountIds.length) return [];
    const cacheKey = `insights:monthly:${userId}:${accountId ?? 'all'}:${months}`;
    const cached = await this.safeCacheGet<MonthlyTotals[]>(cacheKey);
    if (cached) return cached;

    // Live aggregate directly against the Transaction table. We
    // intentionally don't use the `transactions_monthly_v` materialised
    // view here — it's a manual REFRESH in dev, so it goes stale the
    // moment a customer makes a transaction and the chart shows empty
    // even though the row exists. Live aggregate is microseconds at
    // single-user volume and always accurate.
    //
    // `status IN ('posted', 'pending')`: pending transfers are shown in
    // the customer's feed the moment they fire, so Insights includes
    // them too — otherwise a single just-made transfer reads as
    // "Nothing to chart yet" which is what the user complained about.
    // `reversed` and `declined` are intentionally excluded; they're
    // not real movement.
    const rows = await this.prisma.$queryRawUnsafe<MonthlyRow[]>(
      `SELECT
         to_char(date_trunc('month', "occurredAt"), 'YYYY-MM')                          AS year_month,
         date_trunc('month', "occurredAt")                                              AS month_start,
         SUM(CASE WHEN "amountCents" > 0 THEN "amountCents" ELSE 0 END)::bigint         AS total_in_cents,
         SUM(CASE WHEN "amountCents" < 0 THEN -"amountCents" ELSE 0 END)::bigint        AS total_out_cents,
         COUNT(*)                                                                       AS tx_count
       FROM "Transaction"
       WHERE "accountId" = ANY($1::uuid[])
         AND "status"::text IN ('posted', 'pending')
         AND "occurredAt" >= date_trunc('month', NOW()) - ($2 || ' months')::interval
       GROUP BY 1, 2
       ORDER BY 2 DESC`,
      accountIds,
      String(months),
    );
    const result: MonthlyTotals[] = rows.map((r) => ({
      yearMonth: r.year_month,
      monthStart: r.month_start.toISOString(),
      totalInCents: r.total_in_cents.toString(),
      totalOutCents: r.total_out_cents.toString(),
      txCount: Number(r.tx_count),
    }));
    await this.safeCacheSet(cacheKey, result);
    return result;
  }

  async byCategory(userId: string, accountId?: string, monthStart?: Date): Promise<CategoryTotals[]> {
    const accountIds = await this.resolveAccountIds(userId, accountId);
    if (!accountIds.length) return [];
    const start = monthStart ?? startOfCurrentMonth();
    const cacheKey = `insights:byCategory:${userId}:${accountId ?? 'all'}:${start.toISOString()}`;
    const cached = await this.safeCacheGet<CategoryTotals[]>(cacheKey);
    if (cached) return cached;

    // See monthly() for why we skip the materialised view + include
    // pending. Donut should match what the customer sees in their feed.
    const rows = await this.prisma.$queryRawUnsafe<CategoryRow[]>(
      `SELECT
         date_trunc('month', "occurredAt")                                              AS month_start,
         "category"::text                                                                AS category,
         SUM(CASE WHEN "amountCents" < 0 THEN -"amountCents" ELSE 0 END)::bigint        AS total_spent_cents,
         COUNT(*)                                                                       AS tx_count
       FROM "Transaction"
       WHERE "accountId" = ANY($1::uuid[])
         AND "status"::text IN ('posted', 'pending')
         AND date_trunc('month', "occurredAt") = date_trunc('month', $2::timestamp)
       GROUP BY 1, 2
       ORDER BY 3 DESC`,
      accountIds,
      start,
    );
    const result: CategoryTotals[] = rows.map((r) => ({
      monthStart: r.month_start.toISOString(),
      category: r.category,
      totalSpentCents: r.total_spent_cents.toString(),
      txCount: Number(r.tx_count),
    }));
    await this.safeCacheSet(cacheKey, result);
    return result;
  }

  // Cache wrappers — Redis being down shouldn't 500 the whole endpoint.
  // Insights work fine without it, just slower.
  private async safeCacheGet<T>(key: string): Promise<T | null> {
    try {
      return (await this.cache.get<T>(key)) ?? null;
    } catch (err) {
      this.logger.warn(
        `cache.get failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async safeCacheSet<T>(key: string, value: T): Promise<void> {
    try {
      await this.cache.set(key, value, this.cacheTtl);
    } catch (err) {
      this.logger.warn(
        `cache.set failed for ${key}: ${(err as Error).message}`,
      );
    }
  }

  async refreshViews(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY transactions_monthly_v');
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY transactions_by_category_v');
    } catch (err) {
      this.logger.warn(`refresh views failed (falling back to non-concurrent): ${(err as Error).message}`);
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW transactions_monthly_v');
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW transactions_by_category_v');
    }
  }

  private async resolveAccountIds(userId: string, accountId?: string): Promise<string[]> {
    const accounts = await this.prisma.account.findMany({ where: { userId }, select: { id: true } });
    const all = accounts.map((a) => a.id);
    if (!accountId) return all;
    if (!all.includes(accountId)) throw new ForbiddenException('Account not accessible');
    return [accountId];
  }
}

function startOfCurrentMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
