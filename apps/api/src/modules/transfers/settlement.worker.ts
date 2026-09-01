import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionKind, TransactionStatus, TransferKind } from '@prisma/client';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  SYSTEM_LEDGER_CODES,
  accountSubLedgerCode,
} from '../ledger/chart-of-accounts';
import {
  NEST_EVENT,
  NestAccountBalanceChangedPayload,
  NestTransactionCreatedPayload,
  NestTransactionSettledPayload,
  AdminTransferSettledPayload,
} from '../realtime/events';
import { QUEUE_NAMES } from '../workers/bullmq.config';
import { TransfersRepository } from './transfers.repository';

const INFLOW_KINDS: TransferKind[] = ['ach_in', 'wire_in'];

@Processor(QUEUE_NAMES.TransferSettlement)
export class SettlementWorker extends WorkerHost {
  private readonly logger = new Logger(SettlementWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
    private readonly repo: TransfersRepository,
  ) {
    super();
  }

  async process(job: Job<{ transferId: string }>): Promise<void> {
    const transfer = await this.prisma.transfer.findUnique({ where: { id: job.data.transferId } });
    if (!transfer || transfer.status !== TransactionStatus.pending) {
      this.logger.warn(`Skipping settlement of ${job.data.transferId}: status=${transfer?.status}`);
      return;
    }
    const review = (transfer as unknown) as {
      requiresReview?: boolean;
      reviewDecision?: 'approved' | 'rejected' | null;
    };
    if (review.requiresReview && review.reviewDecision !== 'approved') {
      this.logger.log(
        `Holding transfer ${transfer.id} — awaiting admin review (decision=${review.reviewDecision ?? 'pending'})`,
      );
      return;
    }

    const settledTxId = randomUUID();
    const isInflow = INFLOW_KINDS.includes(transfer.kind);
    const direction: 'deposit' | 'withdrawal' = isInflow ? 'deposit' : 'withdrawal';

    await this.prisma.$transaction(async (tx) => {
      const postings: { code: string; direction: 'debit' | 'credit'; amountCents: bigint }[] = [];
      const senderAccount = await tx.account.findUnique({ where: { id: transfer.fromAccountId } });
      if (!senderAccount) throw new Error('Sender account vanished');
      await this.ledger.ensureAccountLedger(senderAccount.id, senderAccount.userId, tx);

      if ((transfer.kind === 'internal' || transfer.kind === 'p2p') && transfer.toAccountId) {
        const dest = await tx.account.findUnique({ where: { id: transfer.toAccountId } });
        if (!dest) throw new Error('Destination account vanished');
        await this.ledger.ensureAccountLedger(dest.id, dest.userId, tx);

        postings.push(
          { code: SYSTEM_LEDGER_CODES.PendingOut, direction: 'debit',  amountCents: transfer.amountCents },
          { code: accountSubLedgerCode(dest.id), direction: 'credit', amountCents: transfer.amountCents },
        );
        await tx.account.update({ where: { id: dest.id }, data: { balanceCents: { increment: transfer.amountCents } } });

        // The credit-side description benefits from the sender's name so
        // the recipient's feed reads "From JANE DOE" rather than a
        // generic "Inbound transfer". We look up the sender once here.
        let senderName = '';
        try {
          const sender = await tx.user.findUnique({
            where: { id: senderAccount.userId },
            select: { firstName: true, lastName: true, novaTag: true, email: true },
          });
          senderName =
            [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim() ||
            sender?.novaTag ||
            sender?.email ||
            '';
        } catch {
          // best-effort; description falls back to a generic label
        }

        const isP2P = transfer.kind === 'p2p';
        await tx.transaction.create({
          data: {
            id: settledTxId,
            accountId: dest.id,
            kind: isP2P ? TransactionKind.p2p_in : TransactionKind.adjustment,
            status: TransactionStatus.posted,
            amountCents: transfer.amountCents,
            description: senderName
              ? `From ${senderName}`
              : isP2P
              ? 'Payment received'
              : 'Internal transfer in',
            category: isP2P ? 'income' : 'transfer',
            occurredAt: new Date(),
            postedAt: new Date(),
            metadata: { transferId: transfer.id },
          },
        });
      } else if (isInflow) {
        postings.push(
          { code: SYSTEM_LEDGER_CODES.Cash,                       direction: 'debit',  amountCents: transfer.amountCents },
          { code: accountSubLedgerCode(senderAccount.id),         direction: 'credit', amountCents: transfer.amountCents },
        );
        await tx.account.update({ where: { id: senderAccount.id }, data: { balanceCents: { increment: transfer.amountCents } } });
        await tx.transaction.create({
          data: {
            accountId: senderAccount.id,
            kind: TransactionKind.ach_in,
            status: TransactionStatus.posted,
            amountCents: transfer.amountCents,
            description: 'Inbound transfer',
            category: 'income',
            occurredAt: new Date(),
            postedAt: new Date(),
            metadata: { transferId: transfer.id },
          },
        });
      } else {
        postings.push(
          { code: SYSTEM_LEDGER_CODES.PendingOut, direction: 'debit',  amountCents: transfer.amountCents },
          { code: SYSTEM_LEDGER_CODES.Cash,       direction: 'credit', amountCents: transfer.amountCents },
        );
      }

      await this.ledger.post(tx, {
        description: `Settle ${transfer.kind}`,
        occurredAt: new Date(),
        source: `transfer:${transfer.id}:settle`,
        referenceId: transfer.id,
        postings,
      });

      if (transfer.pendingTransactionId) {
        await tx.transaction.update({
          where: { id: transfer.pendingTransactionId },
          data: { status: TransactionStatus.posted, postedAt: new Date() },
        });
      }
      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: TransactionStatus.posted, settledAt: new Date(), settledTransactionId: settledTxId },
      });
    });

    const senderFresh = await this.prisma.account.findUnique({ where: { id: transfer.fromAccountId } });
    if (senderFresh) {
      this.events.emit(NEST_EVENT.AccountBalanceChanged, {
        userId: senderFresh.userId,
        accountId: senderFresh.id,
        balanceCents: senderFresh.balanceCents.toString(),
        at: new Date(),
      } satisfies NestAccountBalanceChangedPayload);
    }

    this.events.emit(NEST_EVENT.TransactionSettled, {
      userId: transfer.initiatedByUserId,
      accountId: transfer.fromAccountId,
      transactionId: transfer.pendingTransactionId ?? settledTxId,
      transferId: transfer.id,
      amountCents: transfer.amountCents.toString(),
      at: new Date(),
    } satisfies NestTransactionSettledPayload);

    if ((transfer.kind === 'internal' || transfer.kind === 'p2p') && transfer.toAccountId) {
      const recipient = await this.prisma.account.findUnique({ where: { id: transfer.toAccountId } });
      if (recipient) {
        this.events.emit(NEST_EVENT.TransactionSettled, {
          userId: recipient.userId,
          accountId: recipient.id,
          transactionId: settledTxId,
          transferId: transfer.id,
          amountCents: transfer.amountCents.toString(),
          at: new Date(),
        } satisfies NestTransactionSettledPayload);
        this.events.emit(NEST_EVENT.AccountBalanceChanged, {
          userId: recipient.userId,
          accountId: recipient.id,
          balanceCents: recipient.balanceCents.toString(),
          at: new Date(),
        } satisfies NestAccountBalanceChangedPayload);

        this.events.emit(NEST_EVENT.TransactionCreated, {
          userId: recipient.userId,
          accountId: recipient.id,
          transactionId: settledTxId,
          amountCents: transfer.amountCents.toString(),
          status: TransactionStatus.posted,
          at: new Date(),
        } satisfies NestTransactionCreatedPayload);
      }
    }

    this.events.emit(NEST_EVENT.AdminTransferSettled, {
      transferId: transfer.id,
      userId: transfer.initiatedByUserId,
      direction,
      amountCents: transfer.amountCents,
      kind: transfer.kind,
      settledAt: new Date(),
    } satisfies AdminTransferSettledPayload);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Settlement job ${job.id} failed: ${err.message}`);
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void this.repo.markFailed((job.data as { transferId: string }).transferId, err.message);
    }
  }
}
