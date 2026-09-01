import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OverrideStatus, Prisma, Transaction, TransactionCategory, TransactionKind, TransactionOverride, TransactionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import { LedgerAccountType, PostingDirection } from '@prisma/client';
import { accountSubLedgerCode } from '../../ledger/chart-of-accounts';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { RedisCacheService } from '../../../common/cache/redis-cache.service';
import { NEST_EVENT, NestTransactionCreatedPayload, NestTransactionUpdatedPayload, NestAccountBalanceChangedPayload } from '../../realtime/events';
import { AdminTransactionsRepository } from './admin-transactions.repository';
import { BulkShiftDto, CreateAdminTransactionDto, DeleteAdminTransactionDto, HideTransactionDto, ListAdminTransactionsDto, PatchTransactionDto } from '../dto/admin.dto';
import { decodeCursor, encodeCursor } from '../../transactions/cursor.util';

const ADJUSTMENTS_CODE = 'ADJUSTMENTS';

interface EffectiveFields {
  amountCents: bigint;
  occurredAt: Date;
  description: string;
  category: TransactionCategory;
  status: TransactionStatus;
}

function effectiveOf(t: Transaction & { override: TransactionOverride | null }): EffectiveFields {
  const o = t.override;
  return {
    amountCents: o?.overrideAmountCents ?? t.amountCents,
    occurredAt: o?.overrideOccurredAt ?? t.occurredAt,
    description: o?.overrideDescription ?? t.description,
    category: o?.overrideCategory ?? t.category,
    status: o?.overrideStatus
      ? overrideStatusToTxStatus(o.overrideStatus)
      : t.status,
  };
}

function isHidden(o: TransactionOverride | null): boolean {
  return o?.overrideStatus === OverrideStatus.hidden;
}

/**
 * The TransactionStatus enum (pending|posted|declined|reversed) and the
 * OverrideStatus enum (pending|settled|declined|reversed|hidden) diverge
 * by one name: posted ↔ settled. Override also has `hidden` as a soft-
 * delete flag with no TransactionStatus counterpart. Translating between
 * the two everywhere we cross the boundary keeps Prisma happy.
 */
function txStatusToOverrideStatus(s: TransactionStatus): OverrideStatus {
  switch (s) {
    case TransactionStatus.pending: return OverrideStatus.pending;
    case TransactionStatus.posted: return OverrideStatus.settled;
    case TransactionStatus.declined: return OverrideStatus.declined;
    case TransactionStatus.reversed: return OverrideStatus.reversed;
  }
}

function overrideStatusToTxStatus(s: OverrideStatus): TransactionStatus {
  switch (s) {
    case OverrideStatus.pending: return TransactionStatus.pending;
    case OverrideStatus.settled: return TransactionStatus.posted;
    case OverrideStatus.declined: return TransactionStatus.declined;
    case OverrideStatus.reversed: return TransactionStatus.reversed;
    // `hidden` is a soft-delete signal — when the effective status is
    // requested for a hidden row, surfacing `reversed` keeps callers that
    // don't know about hidden from blowing up. Callers that DO care use
    // isHidden() directly.
    case OverrideStatus.hidden: return TransactionStatus.reversed;
  }
}

@Injectable()
export class AdminTransactionsService {
  private readonly logger = new Logger(AdminTransactionsService.name);
  private readonly rateLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AdminTransactionsRepository,
    private readonly ledger: LedgerService,
    private readonly audit: AdminAuditService,
    private readonly cache: RedisCacheService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.rateLimit = Number(config.get('OVERRIDE_RATE_LIMIT_PER_MIN') ?? 60);
  }

  async list(query: ListAdminTransactionsDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const limit = query.limit ?? 50;
    const rows = await this.repo.list({
      userId: query.userId,
      accountId: query.accountId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursorOccurredAt: cursor ? new Date(cursor.occurredAt) : undefined,
      cursorId: cursor?.id,
      limit,
    });
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as ((Transaction & { override: TransactionOverride | null; account: { userId: string } })[]);
    const last = items[items.length - 1];
    return {
      items: items.map((t) => this.flatten(t)),
      nextCursor: hasMore && last ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id }) : null,
    };
  }

  async getOne(id: string) {
    const row = await this.repo.findWithOverride(id);
    if (!row) throw new NotFoundException('Transaction not found');
    return {
      raw: this.serializeRaw(row),
      effective: this.serializeEffective(row),
      override: row.override ? this.serializeOverride(row.override) : null,
    };
  }

  async patch(actorUserId: string, id: string, dto: PatchTransactionDto) {
    await this.assertRate(actorUserId);
    const row = await this.repo.findWithOverride(id);
    if (!row) throw new NotFoundException('Transaction not found');

    const before = effectiveOf(row);
    const newAmount = dto.amountCents ?? row.override?.overrideAmountCents ?? row.amountCents;
    const delta = newAmount - row.amountCents - (row.override?.overrideAmountCents ? row.override.overrideAmountCents - row.amountCents : 0n);

    if (delta !== 0n && !dto.forceAllowNegative) {
      const account = await this.prisma.account.findUnique({ where: { id: row.accountId } });
      if (!account) throw new NotFoundException('Account not found');
      const projected = account.balanceCents + delta;
      if (projected < 0n) {
        throw new ConflictException({
          error: 'BALANCE_WOULD_GO_NEGATIVE',
          projectedBalanceCents: projected.toString(),
          offsetSuggestion: { transactionId: id, suggestedAmountCents: (newAmount - projected).toString() },
        });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let compensatingEntryId: string | undefined;
      if (delta !== 0n) {
        compensatingEntryId = await this.writeCompensatingEntry(tx, row.accountId, row.account.userId, delta, id);
        await tx.account.update({
          where: { id: row.accountId },
          data: { balanceCents: { increment: delta } },
        });
      }

      const data: Prisma.TransactionOverrideUncheckedCreateInput = {
        transactionId: id,
        appliedByUserId: actorUserId,
        reason: dto.reason,
        overrideAmountCents: dto.amountCents ?? row.override?.overrideAmountCents ?? null,
        overrideOccurredAt: dto.occurredAt ? new Date(dto.occurredAt) : row.override?.overrideOccurredAt ?? null,
        overrideDescription: dto.description ?? row.override?.overrideDescription ?? null,
        overrideCategory: dto.category ?? row.override?.overrideCategory ?? null,
        overrideStatus: dto.status ? txStatusToOverrideStatus(dto.status) : row.override?.overrideStatus ?? null,
        compensatingEntryId: compensatingEntryId ?? row.override?.compensatingEntryId ?? null,
      };

      return tx.transactionOverride.upsert({
        where: { transactionId: id },
        update: data,
        create: data,
      });
    });

    const fresh = await this.repo.findWithOverride(id);
    const after = effectiveOf(fresh!);
    await this.audit.write({
      actorUserId,
      action: 'transaction.override.patch',
      targetType: 'transaction',
      targetId: id,
      metadata: {
        before: this.toJsonable(before),
        after: this.toJsonable(after),
        reason: dto.reason,
      },
    });

    this.emitTxUpdated(fresh!, false);
    if (delta !== 0n) await this.emitBalance(row.accountId);
    return this.serializeEffective(fresh!);
  }

  /**
   * Admin-authored transaction. Creates a fresh Transaction row on an
   * existing Account, writes the matching ledger postings so the running
   * balance stays consistent, and bumps the cached account balance. The
   * customer's UI gets the standard `transaction.created` push.
   */
  async create(actorUserId: string, dto: CreateAdminTransactionDto) {
    await this.assertRate(actorUserId);
    const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const amount = BigInt(dto.amountCents);
    if (amount === 0n) throw new BadRequestException('Amount cannot be zero');
    if (!dto.forceAllowNegative) {
      const projected = account.balanceCents + amount;
      if (projected < 0n) {
        throw new ConflictException({
          error: 'BALANCE_WOULD_GO_NEGATIVE',
          projectedBalanceCents: projected.toString(),
        });
      }
    }

    const kind: TransactionKind =
      (dto.kind as unknown as TransactionKind | undefined) ??
      (amount >= 0n ? TransactionKind.adjustment : TransactionKind.adjustment);

    const created = await this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          accountId: dto.accountId,
          kind,
          status: dto.status,
          amountCents: amount,
          description: dto.description,
          category: dto.category,
          occurredAt: new Date(dto.occurredAt),
          postedAt: dto.status === TransactionStatus.posted ? new Date(dto.occurredAt) : null,
        },
      });
      // Mirror the override flow's bookkeeping — one compensating entry
      // covers the full new amount.
      await this.writeCompensatingEntry(tx, dto.accountId, account.userId, amount, txn.id);
      await tx.account.update({
        where: { id: dto.accountId },
        data: { balanceCents: { increment: amount } },
      });
      return txn;
    });

    await this.audit.write({
      actorUserId,
      action: 'transaction.create',
      targetType: 'transaction',
      targetId: created.id,
      metadata: {
        accountId: created.accountId,
        amountCents: created.amountCents.toString(),
        status: created.status,
        description: created.description,
        category: created.category,
        reason: dto.reason,
      },
    });

    this.events.emit(NEST_EVENT.TransactionCreated, {
      userId: account.userId,
      accountId: created.accountId,
      transactionId: created.id,
      amountCents: created.amountCents.toString(),
      status: created.status,
      at: new Date(),
      description: created.description,
      category: created.category,
      occurredAt: created.occurredAt.toISOString(),
      kind: created.kind,
    } satisfies NestTransactionCreatedPayload);
    await this.emitBalance(dto.accountId);

    const fresh = await this.repo.findWithOverride(created.id);
    return this.serializeEffective(fresh!);
  }

  /**
   * Hard delete: removes the override (FK) and the transaction, posts a
   * compensating ledger entry for the full effective amount so the
   * running balance keeps adding up, and updates the cached account
   * balance. Customer sockets receive `transaction.updated` with
   * `effective: null` + `hidden: true` so the row disappears from their UI
   * the same way the existing hide path makes it disappear.
   */
  async delete(actorUserId: string, id: string, dto: DeleteAdminTransactionDto) {
    await this.assertRate(actorUserId);
    const row = await this.repo.findWithOverride(id);
    if (!row) throw new NotFoundException('Transaction not found');

    // Whatever the customer currently sees on their balance is what we
    // need to roll back — that's the override-applied amount if there's
    // one, otherwise the raw amount.
    const effective = effectiveOf(row);
    const rollback = -effective.amountCents;

    await this.prisma.$transaction(async (tx) => {
      if (effective.amountCents !== 0n) {
        await this.writeCompensatingEntry(tx, row.accountId, row.account.userId, rollback, id);
        await tx.account.update({
          where: { id: row.accountId },
          data: { balanceCents: { increment: rollback } },
        });
      }
      if (row.override) {
        await tx.transactionOverride.delete({ where: { transactionId: id } });
      }
      await tx.transaction.delete({ where: { id } });
    });

    await this.audit.write({
      actorUserId,
      action: 'transaction.delete',
      targetType: 'transaction',
      targetId: id,
      metadata: {
        accountId: row.accountId,
        effectiveAmountCents: effective.amountCents.toString(),
        reason: dto.reason,
      },
    });

    // Same "row is gone" wire as a hide.
    this.events.emit(NEST_EVENT.TransactionUpdated, {
      userId: row.account.userId,
      accountId: row.accountId,
      transactionId: id,
      effective: null,
      hidden: true,
      at: new Date(),
    } satisfies NestTransactionUpdatedPayload);
    if (effective.amountCents !== 0n) await this.emitBalance(row.accountId);

    return { ok: true as const };
  }

  async hide(actorUserId: string, id: string, dto: HideTransactionDto) {
    await this.assertRate(actorUserId);
    const row = await this.repo.findWithOverride(id);
    if (!row) throw new NotFoundException('Transaction not found');
    await this.prisma.transactionOverride.upsert({
      where: { transactionId: id },
      update: { overrideStatus: OverrideStatus.hidden, appliedByUserId: actorUserId, reason: dto.reason },
      create: { transactionId: id, overrideStatus: OverrideStatus.hidden, appliedByUserId: actorUserId, reason: dto.reason },
    });
    await this.audit.write({
      actorUserId,
      action: 'transaction.override.hide',
      targetType: 'transaction',
      targetId: id,
      metadata: { reason: dto.reason },
    });
    const fresh = await this.repo.findWithOverride(id);
    this.emitTxUpdated(fresh!, true);
    return { ok: true };
  }

  async clearOverride(actorUserId: string, id: string) {
    const row = await this.repo.findWithOverride(id);
    if (!row?.override) throw new NotFoundException('No override to clear');
    const deltaToRollback = row.override.overrideAmountCents != null ? row.override.overrideAmountCents - row.amountCents : 0n;
    await this.prisma.$transaction(async (tx) => {
      if (deltaToRollback !== 0n) {
        await this.writeCompensatingEntry(tx, row.accountId, row.account.userId, -deltaToRollback, id);
        await tx.account.update({ where: { id: row.accountId }, data: { balanceCents: { increment: -deltaToRollback } } });
      }
      await tx.transactionOverride.delete({ where: { transactionId: id } });
    });
    await this.audit.write({
      actorUserId,
      action: 'transaction.override.clear',
      targetType: 'transaction',
      targetId: id,
      metadata: { rolledBackDelta: deltaToRollback.toString() },
    });
    const fresh = await this.repo.findWithOverride(id);
    this.emitTxUpdated(fresh!, false);
    if (deltaToRollback !== 0n) await this.emitBalance(row.accountId);
    return { ok: true };
  }

  async bulkShift(actorUserId: string, actorRole: UserRole, dto: BulkShiftDto) {
    if (actorRole !== UserRole.superadmin) throw new ForbiddenException('Superadmin only');
    if (!dto.transactionIds.length) throw new BadRequestException('No transaction ids');
    let updated = 0;
    for (const txId of dto.transactionIds) {
      const row = await this.repo.findWithOverride(txId);
      if (!row) continue;
      const baseDate = row.override?.overrideOccurredAt ?? row.occurredAt;
      const shifted = new Date(baseDate.getTime() + dto.shiftDays * 86_400_000);
      await this.prisma.transactionOverride.upsert({
        where: { transactionId: txId },
        update: { overrideOccurredAt: shifted, appliedByUserId: actorUserId, reason: dto.reason },
        create: { transactionId: txId, overrideOccurredAt: shifted, appliedByUserId: actorUserId, reason: dto.reason },
      });
      updated++;
      const fresh = await this.repo.findWithOverride(txId);
      this.emitTxUpdated(fresh!, false);
    }
    await this.audit.write({
      actorUserId,
      action: 'transaction.bulk_shift',
      targetType: 'transaction_set',
      targetId: dto.transactionIds.join(','),
      metadata: { shiftDays: dto.shiftDays, count: updated, reason: dto.reason },
    });
    return { updated };
  }

  private async writeCompensatingEntry(
    tx: Prisma.TransactionClient,
    accountId: string,
    userId: string,
    delta: bigint,
    referenceId: string,
  ): Promise<string> {
    await this.ledger.ensureAccountLedger(accountId, userId, tx);
    return this.ledger.post(tx, {
      description: `Override adjustment ${delta >= 0n ? '+' : ''}${delta.toString()}`,
      occurredAt: new Date(),
      source: `transaction:${referenceId}:override`,
      referenceId,
      postings: delta > 0n
        ? [
            { code: ADJUSTMENTS_CODE, direction: 'debit', amountCents: delta, meta: { type: LedgerAccountType.expense, normalBalance: PostingDirection.debit } },
            { code: accountSubLedgerCode(accountId), direction: 'credit', amountCents: delta },
          ]
        : [
            { code: accountSubLedgerCode(accountId), direction: 'debit', amountCents: -delta },
            { code: ADJUSTMENTS_CODE, direction: 'credit', amountCents: -delta, meta: { type: LedgerAccountType.expense, normalBalance: PostingDirection.debit } },
          ],
    });
  }

  private async assertRate(actorUserId: string) {
    const key = `override-rate:${actorUserId}:${Math.floor(Date.now() / 60_000)}`;
    const recent = (await this.cache.get<number>(key)) ?? 0;
    if (recent >= this.rateLimit) throw new ForbiddenException('Override rate limit exceeded');
    await this.cache.set(key, recent + 1, 90);
  }

  private flatten(t: Transaction & { override: TransactionOverride | null; account: { userId: string } }) {
    const eff = effectiveOf(t);
    return {
      id: t.id,
      accountId: t.accountId,
      userId: t.account.userId,
      kind: t.kind,
      raw: {
        amountCents: t.amountCents.toString(),
        occurredAt: t.occurredAt.toISOString(),
        description: t.description,
        category: t.category,
        status: t.status,
      },
      effective: {
        amountCents: eff.amountCents.toString(),
        occurredAt: eff.occurredAt.toISOString(),
        description: eff.description,
        category: eff.category,
        status: eff.status,
      },
      hidden: isHidden(t.override),
      override: t.override ? this.serializeOverride(t.override) : null,
    };
  }

  private serializeRaw(t: Transaction) {
    return {
      id: t.id,
      accountId: t.accountId,
      kind: t.kind,
      amountCents: t.amountCents.toString(),
      occurredAt: t.occurredAt.toISOString(),
      description: t.description,
      category: t.category,
      status: t.status,
    };
  }

  private serializeEffective(t: Transaction & { override: TransactionOverride | null }) {
    const eff = effectiveOf(t);
    return {
      transactionId: t.id,
      amountCents: eff.amountCents.toString(),
      occurredAt: eff.occurredAt.toISOString(),
      description: eff.description,
      category: eff.category,
      status: eff.status,
      hidden: isHidden(t.override),
    };
  }

  private serializeOverride(o: TransactionOverride) {
    return {
      id: o.id,
      overrideAmountCents: o.overrideAmountCents?.toString() ?? null,
      overrideOccurredAt: o.overrideOccurredAt?.toISOString() ?? null,
      overrideDescription: o.overrideDescription,
      overrideCategory: o.overrideCategory,
      overrideStatus: o.overrideStatus,
      compensatingEntryId: o.compensatingEntryId,
      appliedByUserId: o.appliedByUserId,
      appliedAt: o.appliedAt.toISOString(),
      reason: o.reason,
    };
  }

  private toJsonable(eff: EffectiveFields) {
    return {
      amountCents: eff.amountCents.toString(),
      occurredAt: eff.occurredAt.toISOString(),
      description: eff.description,
      category: eff.category,
      status: eff.status,
    };
  }

  private async emitTxUpdated(t: Transaction & { override: TransactionOverride | null }, hidden: boolean) {
    const account = await this.prisma.account.findUnique({ where: { id: t.accountId }, select: { userId: true } });
    if (!account) return;
    const eff = effectiveOf(t);
    this.events.emit(NEST_EVENT.TransactionUpdated, {
      userId: account.userId,
      accountId: t.accountId,
      transactionId: t.id,
      effective: hidden ? null : {
        amountCents: eff.amountCents.toString(),
        occurredAt: eff.occurredAt.toISOString(),
        description: eff.description,
        category: eff.category,
        status: eff.status,
      },
      hidden,
      at: new Date(),
    } satisfies NestTransactionUpdatedPayload);
  }

  private async emitBalance(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return;
    this.events.emit(NEST_EVENT.AccountBalanceChanged, {
      userId: account.userId,
      accountId,
      balanceCents: account.balanceCents.toString(),
      at: new Date(),
    } satisfies NestAccountBalanceChangedPayload);
  }
}
