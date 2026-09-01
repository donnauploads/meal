import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transaction, Merchant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsRepository } from './transactions.repository';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import {
  TransactionDto,
  isHiddenByOverride,
  toTransactionDto,
} from './dto/transaction.dto';
import { decodeCursor, encodeCursor } from './cursor.util';

export interface TransactionListPage {
  items: TransactionDto[];
  nextCursor: string | null;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: TransactionsRepository,
    config: ConfigService,
  ) {
    this.defaultLimit = Number(config.get('TX_PAGE_DEFAULT') ?? 25);
    this.maxLimit = Number(config.get('TX_PAGE_MAX') ?? 100);
  }

  async list(userId: string, query: ListTransactionsDto): Promise<TransactionListPage> {
    const accountIds = await this.resolveAccountIds(userId, query.accountId);
    if (!accountIds.length) return { items: [], nextCursor: null };

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const limit = Math.min(query.limit ?? this.defaultLimit, this.maxLimit);

    const rows = await this.repo.list({
      accountIds,
      cursorOccurredAt: cursor ? new Date(cursor.occurredAt) : undefined,
      cursorId: cursor?.id,
      limit,
      q: query.q,
      categories: query.categories,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as (Transaction & {
      merchant: Merchant | null;
      override: import('@prisma/client').TransactionOverride | null;
    })[];
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id })
      : null;

    // Drop rows the admin has marked hidden — customer must never see
    // them. The next-cursor still reflects the underlying page so
    // pagination continues to advance correctly.
    const visible = items.filter((r) => !isHiddenByOverride(r));
    const counterparties = await this.resolveCounterparties(visible);
    return {
      items: visible.map((r) => toTransactionDto(r, counterparties.get(r.id) ?? null)),
      nextCursor,
    };
  }

  async getOne(userId: string, id: string): Promise<TransactionDto> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Transaction not found');
    if (row.account.userId !== userId) throw new NotFoundException('Transaction not found');
    const counterparties = await this.resolveCounterparties([row]);
    return toTransactionDto(row, counterparties.get(row.id) ?? null);
  }

  /**
   * For each transaction tied to a Transfer (metadata.transferId), look up
   * the other side and return its display name. Used to render
   * "Transfer to JANE DOE" / "From JOHN DOE" even when the row's
   * description is a raw user note like "44" or the legacy fallback.
   */
  private async resolveCounterparties(
    rows: { id: string; accountId: string; metadata: unknown }[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const txByTransferId = new Map<string, { txId: string; accountId: string }>();
    const txIds = rows.map((r) => r.id);
    const txAccountById = new Map(rows.map((r) => [r.id, r.accountId]));
    for (const r of rows) {
      const meta = r.metadata as { transferId?: string } | null;
      if (meta?.transferId) txByTransferId.set(meta.transferId, { txId: r.id, accountId: r.accountId });
    }

    // Two link paths into Transfer:
    //   (1) Transaction.metadata.transferId — set when the sender's pending
    //       row is created in transfers.service.ts.
    //   (2) Transfer.pendingTransactionId / settledTransactionId — set by
    //       the settlement worker. Covers older rows whose metadata wasn't
    //       written or got stripped.
    const transfers = await this.prisma.transfer.findMany({
      where: {
        OR: [
          ...(txByTransferId.size ? [{ id: { in: [...txByTransferId.keys()] } }] : []),
          { pendingTransactionId: { in: txIds } },
          { settledTransactionId: { in: txIds } },
        ],
      },
      select: {
        id: true,
        fromAccountId: true,
        toAccountId: true,
        pendingTransactionId: true,
        settledTransactionId: true,
      },
    });
    // Backfill the map with rows we found via path (2).
    for (const t of transfers) {
      const candidateTxId = t.pendingTransactionId ?? t.settledTransactionId;
      if (candidateTxId && txAccountById.has(candidateTxId) && !txByTransferId.has(t.id)) {
        txByTransferId.set(t.id, {
          txId: candidateTxId,
          accountId: txAccountById.get(candidateTxId)!,
        });
      }
    }
    if (txByTransferId.size === 0) return out;

    const accountIds = new Set<string>();
    for (const t of transfers) {
      accountIds.add(t.fromAccountId);
      if (t.toAccountId) accountIds.add(t.toAccountId);
    }
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...accountIds] } },
      select: { id: true, userId: true },
    });
    const userIdByAccount = new Map(accounts.map((a) => [a.id, a.userId]));

    const userIds = new Set<string>();
    for (const uid of userIdByAccount.values()) userIds.add(uid);
    if (userIds.size === 0) return out;

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, firstName: true, lastName: true, novaTag: true, email: true },
    });
    const nameById = new Map<string, string>();
    for (const u of users) {
      const name =
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
        u.novaTag ||
        u.email ||
        '';
      if (name) nameById.set(u.id, name);
    }

    for (const t of transfers) {
      const link = txByTransferId.get(t.id);
      if (!link) continue;
      // If this transaction is on the sender's account, counterparty is the recipient.
      const counterpartyAccountId =
        link.accountId === t.fromAccountId
          ? t.toAccountId
          : link.accountId === t.toAccountId
          ? t.fromAccountId
          : undefined;
      const counterpartyUserId = counterpartyAccountId
        ? userIdByAccount.get(counterpartyAccountId)
        : undefined;
      // Skip self-transfers (internal checking↔savings): both legs belong
      // to the same user, so there's no person to name. Leaving the
      // counterparty unset lets the row's route description ("Checking to
      // Savings") stand instead of "transfer to <your own name>".
      const ownerUserId = userIdByAccount.get(link.accountId);
      if (counterpartyUserId && counterpartyUserId !== ownerUserId) {
        const name = nameById.get(counterpartyUserId);
        if (name) out.set(link.txId, name);
      }
    }

    return out;
  }

  private async resolveAccountIds(userId: string, accountId?: string): Promise<string[]> {
    const accounts = await this.prisma.account.findMany({ where: { userId }, select: { id: true } });
    const all = accounts.map((a) => a.id);
    if (!accountId) return all;
    if (!all.includes(accountId)) throw new ForbiddenException('Account not accessible');
    return [accountId];
  }
}
