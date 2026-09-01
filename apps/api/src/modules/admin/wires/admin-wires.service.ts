import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionKind, TransactionStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import {
  SYSTEM_LEDGER_CODES,
  accountSubLedgerCode,
} from '../../ledger/chart-of-accounts';
import {
  NEST_EVENT,
  NestAccountBalanceChangedPayload,
  NestTransactionCreatedPayload,
  NestTransactionUpdatedPayload,
} from '../../realtime/events';
import { NotificationsService } from '../../notifications/notifications.service';
import { TransfersService } from '../../transfers/transfers.service';
import { ReverseWireDto, WireBeneficiaryDto } from '../dto/admin.dto';

/**
 * Admin services for the wire system:
 *  - CRUD on the WireBeneficiary table (admin-curated list of allowed
 *    wire destinations; customer wires are rejected unless they match
 *    a row).
 *  - List of every wire (in + out) the customer has initiated.
 *  - Reverse a settled wire — credit the sender back, post a reversal
 *    Transaction row to the spending feed, push WS + a notification.
 *
 * Prisma client typings haven't been regenerated yet (the dev API holds
 * the engine DLL on Windows), so we reach for the table via an `as
 * unknown as { wireBeneficiary: any }` cast — same pattern the support
 * service used.
 */
type WithWire = { wireBeneficiary: any };

@Injectable()
export class AdminWiresService {
  private readonly logger = new Logger(AdminWiresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
    private readonly transfers: TransfersService,
  ) {}

  // ─── Beneficiaries ──────────────────────────────────────────────────────

  async listBeneficiaries() {
    return (this.prisma as unknown as WithWire).wireBeneficiary.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createBeneficiary(actorUserId: string, dto: WireBeneficiaryDto) {
    this.validateShape(dto);
    return (this.prisma as unknown as WithWire).wireBeneficiary.create({
      data: {
        id: randomUUID(),
        type: dto.type,
        name: dto.name.trim(),
        bankName: dto.bankName.trim(),
        routingNumber: dto.routingNumber?.trim() ?? null,
        accountNumber: dto.accountNumber?.trim() ?? null,
        swiftBic: dto.swiftBic?.trim().toUpperCase() ?? null,
        iban: dto.iban?.trim().toUpperCase().replace(/\s+/g, '') ?? null,
        country: dto.country?.trim() ?? null,
        beneficiaryAddress: dto.beneficiaryAddress?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
        createdByUserId: actorUserId,
      },
    });
  }

  async updateBeneficiary(id: string, dto: WireBeneficiaryDto) {
    this.validateShape(dto);
    const exists = await (this.prisma as unknown as WithWire).wireBeneficiary.findUnique({
      where: { id },
    });
    if (!exists || exists.archivedAt) throw new NotFoundException('BENEFICIARY_NOT_FOUND');
    return (this.prisma as unknown as WithWire).wireBeneficiary.update({
      where: { id },
      data: {
        type: dto.type,
        name: dto.name.trim(),
        bankName: dto.bankName.trim(),
        routingNumber: dto.routingNumber?.trim() ?? null,
        accountNumber: dto.accountNumber?.trim() ?? null,
        swiftBic: dto.swiftBic?.trim().toUpperCase() ?? null,
        iban: dto.iban?.trim().toUpperCase().replace(/\s+/g, '') ?? null,
        country: dto.country?.trim() ?? null,
        beneficiaryAddress: dto.beneficiaryAddress?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
      },
    });
  }

  async deleteBeneficiary(id: string) {
    const exists = await (this.prisma as unknown as WithWire).wireBeneficiary.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('BENEFICIARY_NOT_FOUND');
    await (this.prisma as unknown as WithWire).wireBeneficiary.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private validateShape(dto: WireBeneficiaryDto) {
    if (dto.type === 'local') {
      // Bahrain domestic wires are keyed by IBAN (no US ABA routing /
      // account number). BH IBAN = "BH" + 2 check digits + 4-letter bank
      // code + 14 alphanumeric = 22 chars. Matches the customer wire flow,
      // which also matches local beneficiaries by IBAN.
      const iban = (dto.iban ?? '').trim().toUpperCase().replace(/\s+/g, '');
      if (!/^BH\d{2}[A-Z]{4}[0-9A-Z]{14}$/.test(iban)) {
        throw new BadRequestException('IBAN_INVALID');
      }
    } else {
      const swift = (dto.swiftBic ?? '').trim().toUpperCase();
      if (!/^[A-Z]{6}[A-Z0-9]{2,5}$/.test(swift)) {
        throw new BadRequestException('SWIFT_INVALID');
      }
      if (!dto.iban?.trim()) throw new BadRequestException('IBAN_REQUIRED');
      if (!dto.country?.trim()) throw new BadRequestException('COUNTRY_REQUIRED');
    }
  }

  // ─── Wires (customer transfers, kind=wire_out/wire_in) ──────────────────

  async listWires(limit = 100) {
    const cap = Math.min(Math.max(limit, 1), 200);
    type Row = {
      id: string;
      kind: string;
      status: string;
      amountCents: bigint;
      feeCents: bigint;
      fromAccountId: string;
      toAccountId: string | null;
      initiatedByUserId: string;
      initiatedAt: Date;
      settledAt: Date | null;
      pendingTransactionId: string | null;
      settledTransactionId: string | null;
      externalRef: string | null;
      requiresReview: boolean;
      reviewDecision: string | null;
      reviewedAt: Date | null;
    };
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, kind, status::text AS status, "amountCents", "feeCents",
              "fromAccountId", "toAccountId", "initiatedByUserId",
              "initiatedAt", "settledAt",
              "pendingTransactionId", "settledTransactionId", "externalRef",
              "requiresReview",
              "reviewDecision"::text AS "reviewDecision",
              "reviewedAt"
         FROM "Transfer"
         WHERE kind IN ('wire_out', 'wire_in')
         ORDER BY "initiatedAt" DESC
         LIMIT $1`,
      cap,
    );
    if (rows.length === 0) return { items: [] };

    const userIds = new Set<string>(rows.map((r) => r.initiatedByUserId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true, firstName: true, lastName: true, novaTag: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return {
      items: rows.map((r) => {
        const u = userById.get(r.initiatedByUserId);
        // Surface `awaitingApproval` so the FE can hang an Approve
        // button. True when the threshold gate flagged the wire and no
        // admin has acted yet.
        const awaitingApproval =
          !!r.requiresReview && !r.reviewedAt && r.status === 'pending';
        return {
          id: r.id,
          kind: r.kind,
          status: r.status,
          amountCents: r.amountCents.toString(),
          feeCents: r.feeCents.toString(),
          initiatedAt: r.initiatedAt.toISOString(),
          settledAt: r.settledAt?.toISOString() ?? null,
          externalRef: r.externalRef,
          pendingTransactionId: r.pendingTransactionId,
          requiresReview: !!r.requiresReview,
          reviewDecision: r.reviewDecision,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          awaitingApproval,
          customer: u
            ? {
                id: u.id,
                name:
                  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
                  u.novaTag ||
                  u.email,
                email: u.email,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Approve a held wire so the settlement worker releases it. Same
   * effect as `/admin/transfers/:id/decision` with decision=approved,
   * but scoped to the Wires dashboard so the operator doesn't have to
   * jump screens.
   */
  async approve(actorUserId: string, transferId: string, reason?: string) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException('TRANSFER_NOT_FOUND');
    if (transfer.kind !== 'wire_out') {
      throw new BadRequestException('ONLY_WIRE_OUT_APPROVABLE');
    }
    const review = transfer as unknown as {
      requiresReview?: boolean;
      reviewedAt?: Date | null;
      reviewDecision?: 'approved' | 'rejected' | null;
    };
    if (!review.requiresReview) {
      throw new BadRequestException('NOT_FLAGGED_FOR_REVIEW');
    }
    if (review.reviewedAt) {
      throw new BadRequestException('ALREADY_REVIEWED');
    }

    // Stamp the row approved.
    await this.prisma.$executeRawUnsafe(
      `UPDATE "Transfer"
          SET "reviewDecision" = 'approved'::"ReviewDecision",
              "reviewedAt"     = NOW(),
              "reviewedByUserId" = $2::uuid,
              "reviewReason"   = $3
        WHERE id = $1::uuid`,
      transferId,
      actorUserId,
      reason ?? null,
    );

    // Kick settlement now — same path the existing transfer review
    // approval uses. forceSettle handles a missing BullMQ queue by
    // running the worker inline so the customer's balance + history
    // tick over immediately even without Redis.
    try {
      await this.transfers.forceSettle(transferId);
    } catch (err) {
      this.logger.warn(
        `forceSettle after wire approval failed for ${transferId}: ${(err as Error).message}`,
      );
    }
    this.events.emit('admin.queue.changed', { transferReviewDelta: -1 });

    return { id: transferId, decision: 'approved' as const };
  }

  /**
   * Reverse a settled (or pending) outbound wire:
   *   - Refund amount + fee to the sender's account.
   *   - Post a positive "Wire reversal" Transaction in their feed.
   *   - Mark the original pending/settled Transaction as `reversed`.
   *   - Mark the Transfer row `reversed` + write the reason.
   *   - Push WS events so the customer sees balance + history flip live,
   *     and drop a notification with the reason.
   */
  async reverse(actorUserId: string, transferId: string, dto: ReverseWireDto) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException('TRANSFER_NOT_FOUND');
    if (transfer.kind !== 'wire_out') {
      throw new BadRequestException('ONLY_WIRE_OUT_REVERSIBLE');
    }
    if (transfer.status === TransactionStatus.reversed) {
      throw new BadRequestException('ALREADY_REVERSED');
    }

    const refund = transfer.amountCents + transfer.feeCents;
    const reversalTxId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      const senderAccount = await tx.account.findUnique({ where: { id: transfer.fromAccountId } });
      if (!senderAccount) throw new Error('Sender account vanished');
      await this.ledger.ensureAccountLedger(senderAccount.id, senderAccount.userId, tx);

      await tx.account.update({
        where: { id: senderAccount.id },
        data: { balanceCents: { increment: refund } },
      });

      await this.ledger.post(tx, {
        description: `Reverse wire (admin: ${actorUserId})`,
        occurredAt: new Date(),
        source: `transfer:${transferId}:admin-reverse`,
        referenceId: transferId,
        postings: [
          { code: SYSTEM_LEDGER_CODES.Cash, direction: 'debit', amountCents: transfer.amountCents },
          { code: accountSubLedgerCode(senderAccount.id), direction: 'credit', amountCents: transfer.amountCents },
          ...(transfer.feeCents > 0n
            ? [
                { code: SYSTEM_LEDGER_CODES.FeeRevenue, direction: 'debit' as const, amountCents: transfer.feeCents },
                { code: accountSubLedgerCode(senderAccount.id), direction: 'credit' as const, amountCents: transfer.feeCents },
              ]
            : []),
        ],
      });

      // New positive Transaction in the customer's feed so the reversal
      // shows up in their history as a discrete row.
      await tx.transaction.create({
        data: {
          id: reversalTxId,
          accountId: senderAccount.id,
          kind: TransactionKind.adjustment,
          status: TransactionStatus.posted,
          amountCents: refund,
          description: `Wire reversal — ${dto.reason}`.slice(0, 280),
          category: 'transfer',
          occurredAt: new Date(),
          postedAt: new Date(),
          metadata: { transferId, reversedByAdmin: actorUserId },
        },
      });

      // Flip the original outbound row(s) to `reversed`. `updateMany` is
      // used instead of `update` so the call no-ops when the referenced
      // Transaction row has been compacted/manually deleted, rather than
      // throwing P2025 and aborting the whole reversal mid-transaction.
      if (transfer.pendingTransactionId) {
        await tx.transaction.updateMany({
          where: { id: transfer.pendingTransactionId },
          data: { status: TransactionStatus.reversed, postedAt: new Date() },
        });
      }
      if (transfer.settledTransactionId) {
        await tx.transaction.updateMany({
          where: { id: transfer.settledTransactionId },
          data: { status: TransactionStatus.reversed },
        });
      }

      await tx.transfer.update({
        where: { id: transferId },
        data: {
          status: TransactionStatus.reversed,
          failureReason: dto.reason,
          settledAt: transfer.settledAt ?? new Date(),
        },
      });
    });

    const fresh = await this.prisma.account.findUnique({ where: { id: transfer.fromAccountId } });
    if (fresh) {
      this.events.emit(NEST_EVENT.AccountBalanceChanged, {
        userId: fresh.userId,
        accountId: fresh.id,
        balanceCents: fresh.balanceCents.toString(),
        at: new Date(),
      } satisfies NestAccountBalanceChangedPayload);
    }

    // New positive row → emit transaction.created so it appears in the
    // customer's feed without a refetch.
    if (fresh) {
      this.events.emit(NEST_EVENT.TransactionCreated, {
        userId: fresh.userId,
        accountId: transfer.fromAccountId,
        transactionId: reversalTxId,
        amountCents: refund.toString(),
        status: TransactionStatus.posted,
        at: new Date(),
      } satisfies NestTransactionCreatedPayload);
    }

    // Original outbound row → emit transaction.updated so any open
    // detail sheet flips to `reversed`.
    if (fresh && transfer.pendingTransactionId) {
      this.events.emit(NEST_EVENT.TransactionUpdated, {
        userId: fresh.userId,
        accountId: transfer.fromAccountId,
        transactionId: transfer.pendingTransactionId,
        effective: {
          amountCents: (-(transfer.amountCents + transfer.feeCents)).toString(),
          occurredAt: new Date().toISOString(),
          description: 'Wire (reversed)',
          category: 'transfer',
          status: TransactionStatus.reversed,
        },
        hidden: false,
        at: new Date(),
      } satisfies NestTransactionUpdatedPayload);
    }

    if (fresh) {
      try {
        await this.notifications.create({
          userId: fresh.userId,
          category: 'transaction',
          title: 'Wire reversed',
          body: `Your wire of ${formatCents(transfer.amountCents)} was reversed by support. Reason: ${dto.reason}`,
          ctaUrl: '/home/spending',
        });
      } catch (err) {
        this.logger.warn(`notification failed after reverse ${transferId}: ${(err as Error).message}`);
      }
    }

    return { id: transferId, reversalTransactionId: reversalTxId };
  }
}

function formatCents(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  const dollars = abs / 100n;
  const cents = abs % 100n;
  return `${sign}$${dollars.toString()}.${cents.toString().padStart(2, '0')}`;
}
