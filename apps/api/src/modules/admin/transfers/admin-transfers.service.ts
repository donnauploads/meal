import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TransfersService } from '../../transfers/transfers.service';
import { LedgerService } from '../../ledger/ledger.service';
import {
  SYSTEM_LEDGER_CODES,
  accountSubLedgerCode,
} from '../../ledger/chart-of-accounts';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { TransferReviewDecisionDto } from '../dto/admin.dto';
import { EmailService } from '../../../common/email/email.service';
import { buildTransferReviewApprovedEmail } from '../../transfers/templates/transfer-review-approved.email';
import { buildTransferReviewDeclinedEmail } from '../../transfers/templates/transfer-review-declined.email';
import {
  NEST_EVENT,
  NestAccountBalanceChangedPayload,
  NestTransactionSettledPayload,
} from '../../realtime/events';

/** Human label per transfer kind for the customer-facing decision email. */
const KIND_LABEL: Record<string, string> = {
  wire_out: 'Wire transfer',
  ach_out: 'Bank transfer',
  ach_in: 'Bank transfer',
  p2p: 'Transfer',
  internal: 'Transfer',
};

/**
 * Admin operations for transfers held under threshold review.
 *
 * The review gate is set inside `TransfersService.initiate()` whenever
 * an outbound transfer's amount is at or above
 * `TRANSFER_REVIEW_THRESHOLD_CENTS`. While `requiresReview === true`
 * and `reviewDecision !== 'approved'`, the settlement worker refuses to
 * settle the row — so funds debited from the sender remain pending
 * until an admin acts here.
 */
@Injectable()
export class AdminTransfersService {
  private readonly logger = new Logger(AdminTransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
    private readonly ledger: LedgerService,
    private readonly audit: AdminAuditService,
    private readonly events: EventEmitter2,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Email the customer the outcome of an admin review — for BOTH approved and
   * rejected. Best-effort: the EmailService is fire-and-forget and any failure
   * here is swallowed so it never blocks the decision from committing.
   */
  private async sendDecisionEmail(
    transfer: {
      id: string;
      kind: string;
      amountCents: bigint;
      initiatedByUserId: string;
    },
    decision: 'approved' | 'rejected',
    reason?: string | null,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: transfer.initiatedByUserId },
        select: { email: true, firstName: true },
      });
      if (!user?.email) return;

      const webBaseUrl =
        this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000';
      const amount = (Number(transfer.amountCents) / 100).toLocaleString(
        'en-US',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
      );
      const kindLabel = KIND_LABEL[transfer.kind] ?? 'Transfer';

      const mail =
        decision === 'approved'
          ? buildTransferReviewApprovedEmail({
              firstName: user.firstName,
              kindLabel,
              amount,
              currency: 'USD',
              approvedAt: new Date(),
              webBaseUrl,
            })
          : buildTransferReviewDeclinedEmail({
              firstName: user.firstName,
              kindLabel,
              amount,
              currency: 'USD',
              reason: reason?.trim() || 'Declined after review',
              declinedAt: new Date(),
              webBaseUrl,
            });

      await this.email.send({
        to: user.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (err) {
      this.logger.warn(
        `transfer decision email failed for ${transfer.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Pending review queue — outbound transfers that hit the threshold and
   * haven't been decided. Newest first so reviewers see the latest pings.
   * `requiresReview` lives on the Transfer row but isn't in the strongly
   * typed Prisma client yet (the project keeps the prisma client a
   * generation behind during dev). We hit it via `$queryRawUnsafe` with
   * explicit casts; the shape we return is what the admin UI wants.
   */
  async listReviewQueue(limit = 50) {
    const cap = Math.min(Math.max(limit, 1), 100);
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
      pendingTransactionId: string | null;
      requiresReview: boolean;
      reviewDecision: string | null;
      reviewedAt: Date | null;
    };
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, kind, status::text AS status, "amountCents", "feeCents",
              "fromAccountId", "toAccountId", "initiatedByUserId", "initiatedAt",
              "pendingTransactionId",
              "requiresReview", "reviewDecision"::text AS "reviewDecision", "reviewedAt"
         FROM "Transfer"
         WHERE "requiresReview" = true AND "reviewedAt" IS NULL
         ORDER BY "initiatedAt" DESC
         LIMIT $1`,
      cap,
    );

    if (rows.length === 0) return { items: [] };

    const accountIds = new Set<string>();
    const userIds = new Set<string>();
    for (const r of rows) {
      accountIds.add(r.fromAccountId);
      if (r.toAccountId) accountIds.add(r.toAccountId);
      userIds.add(r.initiatedByUserId);
    }
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...accountIds] } },
      select: { id: true, userId: true, type: true, label: true, mockAccountNumber: true },
    });
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    for (const a of accounts) userIds.add(a.userId);

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, firstName: true, lastName: true, email: true, novaTag: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    function describeUser(uid?: string | null) {
      if (!uid) return null;
      const u = userById.get(uid);
      if (!u) return null;
      return {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.novaTag || u.email,
        email: u.email,
        novaTag: u.novaTag,
      };
    }

    return {
      items: rows.map((r) => {
        const fromAcct = acctById.get(r.fromAccountId);
        const toAcct = r.toAccountId ? acctById.get(r.toAccountId) : null;
        return {
          id: r.id,
          kind: r.kind,
          status: r.status,
          amountCents: r.amountCents.toString(),
          feeCents: r.feeCents.toString(),
          initiatedAt: r.initiatedAt.toISOString(),
          sender: describeUser(r.initiatedByUserId),
          recipient: describeUser(toAcct?.userId ?? null),
          fromAccount: fromAcct
            ? { id: fromAcct.id, type: fromAcct.type, label: fromAcct.label, mask: fromAcct.mockAccountNumber.slice(-4) }
            : null,
          toAccount: toAcct
            ? { id: toAcct.id, type: toAcct.type, label: toAcct.label, mask: toAcct.mockAccountNumber.slice(-4) }
            : null,
        };
      }),
    };
  }

  async decide(actorUserId: string, transferId: string, dto: TransferReviewDecisionDto) {
    if (dto.decision === 'rejected' && !dto.reason?.trim()) {
      throw new BadRequestException('reason required when rejecting');
    }

    const transfer = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException('TRANSFER_NOT_FOUND');
    const review = (transfer as unknown) as {
      requiresReview?: boolean;
      reviewedAt?: Date | null;
      reviewDecision?: 'approved' | 'rejected' | null;
    };
    if (!review.requiresReview) throw new BadRequestException('Transfer is not flagged for review');
    if (review.reviewedAt) throw new BadRequestException('Transfer already reviewed');

    if (dto.decision === 'approved') {
      // Stamp the row approved + clear review; the next settle call
      // (via forceSettle below) will go straight through the worker.
      await this.prisma.$executeRawUnsafe(
        `UPDATE "Transfer"
            SET "reviewDecision" = 'approved'::"ReviewDecision",
                "reviewedAt"     = NOW(),
                "reviewedByUserId" = $2::uuid,
                "reviewReason"   = $3
          WHERE id = $1::uuid`,
        transferId,
        actorUserId,
        dto.reason ?? null,
      );
      await this.audit.write({
        actorUserId,
        action: 'transfer.review.approve',
        targetType: 'transfer',
        targetId: transferId,
        metadata: { reason: dto.reason ?? null, amountCents: transfer.amountCents.toString() },
      });
      this.events.emit('admin.queue.changed', { transferReviewDelta: -1 });

      // Kick settlement now. forceSettle handles missing queue / Redis
      // gracefully — the same path normal pays travel through.
      try {
        await this.transfers.forceSettle(transferId);
      } catch (err) {
        this.logger.warn(
          `forceSettle after approve failed for ${transferId}: ${(err as Error).message}`,
        );
      }
      await this.sendDecisionEmail(transfer, 'approved');
      return { id: transferId, decision: 'approved' as const };
    }

    // Reject path — reverse the sender's debit, mark transfer reversed,
    // mark pending transaction reversed too. Mirror entries in the
    // ledger so the chart of accounts stays balanced.
    await this.prisma.$transaction(async (tx) => {
      const senderAcct = await tx.account.findUnique({ where: { id: transfer.fromAccountId } });
      if (!senderAcct) throw new Error('Sender account vanished');
      await this.ledger.ensureAccountLedger(senderAcct.id, senderAcct.userId, tx);

      const refund = transfer.amountCents + transfer.feeCents;
      await tx.account.update({
        where: { id: senderAcct.id },
        data: { balanceCents: { increment: refund } },
      });

      await this.ledger.post(tx, {
        description: `Reverse ${transfer.kind} (rejected by admin)`,
        occurredAt: new Date(),
        source: `transfer:${transferId}:reject`,
        referenceId: transferId,
        postings: [
          { code: SYSTEM_LEDGER_CODES.PendingOut, direction: 'debit', amountCents: transfer.amountCents },
          { code: accountSubLedgerCode(senderAcct.id), direction: 'credit', amountCents: transfer.amountCents },
          ...(transfer.feeCents > 0n
            ? [
                { code: SYSTEM_LEDGER_CODES.FeeRevenue, direction: 'debit' as const, amountCents: transfer.feeCents },
                { code: accountSubLedgerCode(senderAcct.id), direction: 'credit' as const, amountCents: transfer.feeCents },
              ]
            : []),
        ],
      });

      if (transfer.pendingTransactionId) {
        await tx.transaction.update({
          where: { id: transfer.pendingTransactionId },
          data: { status: TransactionStatus.reversed, postedAt: new Date() },
        });
      }

      await tx.$executeRawUnsafe(
        `UPDATE "Transfer"
            SET status = 'reversed'::"TransactionStatus",
                "reviewDecision" = 'rejected'::"ReviewDecision",
                "reviewedAt" = NOW(),
                "reviewedByUserId" = $2::uuid,
                "reviewReason" = $3,
                "failureReason" = $3
          WHERE id = $1::uuid`,
        transferId,
        actorUserId,
        dto.reason ?? 'Rejected by admin',
      );
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
    if (transfer.pendingTransactionId) {
      this.events.emit(NEST_EVENT.TransactionSettled, {
        userId: transfer.initiatedByUserId,
        accountId: transfer.fromAccountId,
        transactionId: transfer.pendingTransactionId,
        transferId: transfer.id,
        amountCents: transfer.amountCents.toString(),
        at: new Date(),
      } satisfies NestTransactionSettledPayload);
    }

    await this.audit.write({
      actorUserId,
      action: 'transfer.review.reject',
      targetType: 'transfer',
      targetId: transferId,
      metadata: { reason: dto.reason, amountCents: transfer.amountCents.toString() },
    });
    this.events.emit('admin.queue.changed', { transferReviewDelta: -1 });

    await this.sendDecisionEmail(transfer, 'rejected', dto.reason);
    return { id: transferId, decision: 'rejected' as const };
  }

  async queueCounts() {
    // Single round trip: seven scalar subqueries in one SELECT instead of
    // seven sequential queries. Against a remote DB (e.g. Neon) this cuts the
    // endpoint's latency from 7× network round trips to 1. Raw SQL because a
    // few of these models live outside the typed Prisma wrapper used here.
    const [row] = await this.prisma.$queryRawUnsafe<
      {
        kyc_pending: bigint;
        kyc_approved: bigint;
        transfer_review: bigint;
        users_active: bigint;
        sessions_active: bigint;
        support_unread: bigint;
        mail_unread: bigint;
      }[]
    >(
      `SELECT
         (SELECT COUNT(*)::bigint FROM "KycRecord" WHERE status IN ('pending', 'in_review')) AS kyc_pending,
         (SELECT COUNT(*)::bigint FROM "KycRecord" WHERE status = 'approved') AS kyc_approved,
         (SELECT COUNT(*)::bigint FROM "Transfer" WHERE "requiresReview" = true AND "reviewedAt" IS NULL) AS transfer_review,
         (SELECT COUNT(*)::bigint FROM "User" WHERE status = 'active') AS users_active,
         (SELECT COUNT(*)::bigint FROM "Session" WHERE "revokedAt" IS NULL AND "expiresAt" > NOW()) AS sessions_active,
         (SELECT COUNT(*)::bigint FROM "SupportThread" WHERE "unreadForAdmins" = true) AS support_unread,
         (SELECT COUNT(*)::bigint FROM "MailThread" WHERE "unreadForAdmins" = true) AS mail_unread`,
    );
    return {
      kycPending: Number(row?.kyc_pending ?? 0n),
      kycApproved: Number(row?.kyc_approved ?? 0n),
      transferReviewPending: Number(row?.transfer_review ?? 0n),
      totalUsers: Number(row?.users_active ?? 0n),
      activeSessions: Number(row?.sessions_active ?? 0n),
      supportUnreadThreads: Number(row?.support_unread ?? 0n),
      mailUnreadThreads: Number(row?.mail_unread ?? 0n),
    };
  }
}
