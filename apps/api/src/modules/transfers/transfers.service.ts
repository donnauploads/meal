import { InjectQueue } from '@nestjs/bullmq';
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
import {
  Prisma,
  TransactionKind,
  TransactionStatus,
  Transfer,
  TransferKind,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  SYSTEM_LEDGER_CODES,
  accountSubLedgerCode,
} from '../ledger/chart-of-accounts';
import { NEST_EVENT, NestTransactionCreatedPayload } from '../realtime/events';
import { TransfersRepository } from './transfers.repository';
import { QUEUE_NAMES } from '../workers/bullmq.config';
import { computeQuote, QuoteResult } from './quote.util';
import { InitiateTransferDto } from './dto/initiate-transfer.dto';
import { SettlementWorker } from './settlement.worker';
import type { Job } from 'bullmq';
import { Inject, forwardRef } from '@nestjs/common';
import { FxService, FxConversion } from '../fx/fx.service';
import { QuoteDto } from './dto/quote.dto';

const KIND_TO_TX_KIND: Record<TransferKind, TransactionKind> = {
  internal: TransactionKind.adjustment,
  ach_in: TransactionKind.ach_in,
  ach_out: TransactionKind.ach_out,
  wire_in: TransactionKind.ach_in,
  wire_out: TransactionKind.ach_out,
  p2p: TransactionKind.p2p_out,
};

export interface FxPayload {
  sendCurrency: string;
  sendAmountMinor: string;
  settleCurrency: string;
  settleCents: string;
  rate: number;
  asOf: string;
  source: string;
}

export interface InitiateResult {
  transferId: string;
  status: TransactionStatus;
  pendingTransactionId: string;
  feeCents: string;
  estimatedSettleMs: number;
  fx?: FxPayload | null;
}

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);
  private readonly minCents: bigint;
  private readonly maxCents: bigint;
  private readonly wireMaxCents: bigint;
  private readonly feeBps: number;
  private readonly feeMin: bigint;
  private readonly settleInstantMs: number;
  private readonly settleStandardMs: number;
  private readonly reviewThresholdCents: bigint;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: TransfersRepository,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
    @InjectQueue(QUEUE_NAMES.TransferSettlement) private readonly settlementQueue: Queue,
    @Inject(forwardRef(() => SettlementWorker))
    private readonly settlementWorker: SettlementWorker,
    private readonly fx: FxService,
    config: ConfigService,
  ) {
    this.minCents = BigInt(config.get<string>('TRANSFER_MIN_CENTS') ?? 500);
    this.maxCents = BigInt(config.get<string>('TRANSFER_MAX_CENTS') ?? 2_500_000);
    // Wires have their own (much higher) ceiling — real-bank wire limits are
    // commonly $250k–$1M. Default $500,000.
    this.wireMaxCents = BigInt(
      config.get<string>('WIRE_MAX_CENTS') ?? 50_000_000,
    );
    this.feeBps = Number(config.get('TRANSFER_INSTANT_FEE_BPS') ?? 175);
    this.feeMin = BigInt(config.get<string>('TRANSFER_INSTANT_FEE_MIN_CENTS') ?? 25);
    this.settleInstantMs = Number(config.get('TRANSFER_SETTLE_INSTANT_MS') ?? 5000);
    this.settleStandardMs = Number(config.get('TRANSFER_SETTLE_STANDARD_MS') ?? 30000);
    // Default review threshold = $1,000. Any transfer at or above this
    // (after the configured minimum) is held in `requiresReview` until an
    // admin approves it from the review queue.
    this.reviewThresholdCents = BigInt(
      config.get<string>('TRANSFER_REVIEW_THRESHOLD_CENTS') ?? 100_000,
    );
  }

  quote(
    kind: TransferKind,
    amountCents: bigint,
    instant: boolean,
    wireScope?: 'domestic' | 'international',
  ): QuoteResult {
    return computeQuote({
      kind,
      amountCents,
      instant,
      minCents: this.minCents,
      maxCents: kind === 'wire_out' ? this.wireMaxCents : this.maxCents,
      instantFeeBps: this.feeBps,
      instantFeeMinCents: this.feeMin,
      wireScope,
    });
  }

  /**
   * Resolve the USD *settlement* amount for a request. For an FX wire
   * (sendCurrency set + not USD) the customer's send amount is converted
   * to USD via the FxService; otherwise the USD `amountCents` is used
   * verbatim. Returns the conversion snapshot (or null) so callers can
   * lock, persist, and display the exact rate applied.
   */
  private async resolveSettlement(input: {
    kind: TransferKind;
    amountCents: bigint;
    sendCurrency?: string;
    sendAmountMinor?: bigint;
  }): Promise<{ settlementCents: bigint; fx: FxConversion | null }> {
    const send = (input.sendCurrency ?? 'USD').toUpperCase();
    if (
      input.kind === 'wire_out' &&
      input.sendCurrency &&
      input.sendAmountMinor != null
    ) {
      const conv = await this.fx.convert(input.sendAmountMinor, send, 'USD');
      // No FX line when the send currency IS the settlement currency
      // (USD→USD is an identity conversion), but still trust the send
      // amount as the authoritative settlement figure.
      return {
        settlementCents: conv.toAmountMinor,
        fx: conv.from === conv.to ? null : conv,
      };
    }
    return { settlementCents: input.amountCents, fx: null };
  }

  /** Serialise an FX conversion for API responses + audit metadata. */
  private fxPayload(fx: FxConversion) {
    return {
      sendCurrency: fx.from,
      sendAmountMinor: fx.fromAmountMinor.toString(),
      settleCurrency: fx.to,
      settleCents: fx.toAmountMinor.toString(),
      rate: fx.rate,
      asOf: fx.asOf,
      source: fx.source,
    };
  }

  /**
   * FX-aware quote behind POST /transfers/quote. Converts the send
   * currency to USD (when applicable), prices the fee on the USD
   * settlement, and returns the conversion breakdown for the UI.
   */
  async quoteForRequest(dto: QuoteDto) {
    const { settlementCents, fx } = await this.resolveSettlement(dto);
    const q = this.quote(
      dto.kind,
      settlementCents,
      !!dto.instant,
      dto.wireScope,
    );
    return {
      valid: q.valid,
      feeCents: q.feeCents.toString(),
      etaText: q.etaText,
      minAmountCents: q.minAmountCents.toString(),
      maxAmountCents: q.maxAmountCents.toString(),
      reason: q.reason,
      settleCents: settlementCents.toString(),
      fx: fx ? this.fxPayload(fx) : null,
    };
  }

  /**
   * Live beneficiary check used by the wire form as the customer types the
   * routing + account (or SWIFT + IBAN) numbers. Matches against the
   * admin-approved WireBeneficiary list.
   *
   * Matching is forgiving on the typed labels: the NUMBERS must match an
   * approved beneficiary, then we accept it if EITHER the entered bank name
   * OR the entered beneficiary name matches the record on file (case- and
   * whitespace-insensitive). This stops a slightly-off bank name (e.g.
   * "chase" vs "Chase Bank") from blocking a wire whose numbers + payee
   * are correct. If neither label is supplied, the numbers alone suffice.
   *
   * Read-only and side-effect free — safe to call (debounced) per keystroke.
   */
  async verifyBeneficiary(input: {
    type: 'local' | 'international';
    bankName?: string;
    beneficiaryName?: string;
    routingNumber?: string;
    accountNumber?: string;
    swiftBic?: string;
    iban?: string;
  }): Promise<{ valid: boolean; beneficiaryName: string | null }> {
    const where: Record<string, unknown> = {
      archivedAt: null,
      type: input.type,
    };
    if (input.type === 'local') {
      // Bahrain domestic wires are identified by IBAN (no ABA routing).
      const ibanNorm = (input.iban ?? '').trim().toUpperCase().replace(/\s+/g, '');
      if (!ibanNorm) {
        return { valid: false, beneficiaryName: null };
      }
      where.iban = ibanNorm;
    } else {
      if (!input.swiftBic || !input.iban) {
        return { valid: false, beneficiaryName: null };
      }
      where.swiftBic = input.swiftBic.trim().toUpperCase();
      where.iban = input.iban.trim().toUpperCase().replace(/\s+/g, '');
    }

    const candidates = await (
      this.prisma as unknown as {
        wireBeneficiary: {
          findMany: (
            args: unknown,
          ) => Promise<Array<{ name: string; bankName: string }>>;
        };
      }
    ).wireBeneficiary.findMany({ where });
    if (candidates.length === 0) {
      return { valid: false, beneficiaryName: null };
    }

    const norm = (s?: string) => (s ?? '').trim().toLowerCase();
    const typedBank = norm(input.bankName);
    const typedName = norm(input.beneficiaryName);

    // No labels typed → numbers alone are enough (first candidate).
    if (!typedBank && !typedName) {
      return { valid: true, beneficiaryName: candidates[0].name };
    }

    // Accept the candidate whose bank OR payee name matches what was typed.
    const matched = candidates.find(
      (c) =>
        (typedBank && norm(c.bankName) === typedBank) ||
        (typedName && norm(c.name) === typedName),
    );
    return matched
      ? { valid: true, beneficiaryName: matched.name }
      : { valid: false, beneficiaryName: null };
  }

  async initiate(userId: string, idempotencyKey: string, dto: InitiateTransferDto): Promise<InitiateResult> {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header required');

    // Admin-controlled lock. Catches every money-movement path that
    // goes through this method: pay/P2P, wire_out, internal (savings
    // ←→ checking), ach_out, goal contributions, recurring runs.
    //
    // Read via raw SQL — the Prisma client typings here haven't been
    // regenerated since the column was added in migration
    // 20260531200000_user_transfers_disabled (engine DLL was locked by
    // the dev server when `prisma generate` would have run). Raw SQL
    // sidesteps both the TS check and Prisma's runtime select-shape
    // validator, which rejects unknown fields.
    const rows = await this.prisma.$queryRaw<{ transfersDisabled: boolean }[]>`
      SELECT "transfersDisabled"
        FROM "User"
       WHERE "id" = ${userId}::uuid
       LIMIT 1
    `;
    if (rows[0]?.transfersDisabled) {
      throw new ForbiddenException('TRANSFERS_DISABLED');
    }

    const replay = await this.repo.findByIdempotencyKey(idempotencyKey);
    if (replay) {
      if (replay.initiatedByUserId !== userId) throw new ConflictException('Idempotency key already used by another user');
      return {
        transferId: replay.id,
        status: replay.status,
        pendingTransactionId: replay.pendingTransactionId ?? '',
        feeCents: replay.feeCents.toString(),
        estimatedSettleMs: replay.instant ? this.settleInstantMs : this.settleStandardMs,
      };
    }

    // Derive the wire scope from the supplied wire details so the fee
    // we settle matches the quote the customer reviewed.
    const wireScope: 'domestic' | 'international' | undefined =
      dto.kind === 'wire_out' && dto.wireDetails
        ? dto.wireDetails.type === 'international'
          ? 'international'
          : 'domestic'
        : undefined;
    // FX: convert the customer's send currency to the USD settlement
    // amount (a no-op for USD wires). The ledger is USD, so every debit /
    // posting / balance check downstream uses `settlementCents`.
    const { settlementCents, fx } = await this.resolveSettlement({
      kind: dto.kind,
      amountCents: dto.amountCents,
      sendCurrency: dto.sendCurrency,
      sendAmountMinor: dto.sendAmountMinor,
    });
    const quote = this.quote(dto.kind, settlementCents, !!dto.instant, wireScope);
    if (!quote.valid) throw new BadRequestException(quote.reason ?? 'Invalid transfer');

    // Wire-out gate. LOCAL (Bahrain) wires must go to a beneficiary the admin
    // has pre-approved — matched by (type + iban). INTERNATIONAL wires accept
    // whatever the customer enters (no approved-list match); we only require
    // the core fields to be present. The wire still lands in the admin review
    // queue before any money moves.
    if (dto.kind === 'wire_out') {
      if (!dto.wireDetails) {
        throw new BadRequestException('WIRE_DETAILS_REQUIRED');
      }
      const w = dto.wireDetails;
      if (w.type === 'local') {
        const ibanNorm = (w.iban ?? '').trim().toUpperCase().replace(/\s+/g, '');
        if (!ibanNorm) {
          throw new BadRequestException('WIRE_DETAILS_INCOMPLETE');
        }
        const match = await (this.prisma as unknown as {
          wireBeneficiary: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
        }).wireBeneficiary.findFirst({
          where: { archivedAt: null, type: 'local', iban: ibanNorm },
        });
        if (!match) {
          // 422 — semantically "validated input but business rule fails".
          // Frontend distinguishes this from generic 400s.
          throw new BadRequestException('BENEFICIARY_NOT_FOUND');
        }
      } else {
        // International — accept any beneficiary; just require SWIFT + IBAN.
        if (!w.swiftBic || !w.iban) {
          throw new BadRequestException('WIRE_DETAILS_INCOMPLETE');
        }
      }
    }

    const fromAccount = await this.prisma.account.findUnique({ where: { id: dto.fromAccountId } });
    if (!fromAccount) throw new NotFoundException('Source account not found');
    if (fromAccount.userId !== userId) throw new ForbiddenException('Not your account');
    if (fromAccount.status !== 'active') throw new BadRequestException('Source account not active');

    let toAccount = null;
    if (dto.kind === 'internal') {
      if (!dto.toAccountId) throw new BadRequestException('toAccountId required for internal transfer');
      toAccount = await this.prisma.account.findUnique({ where: { id: dto.toAccountId } });
      if (!toAccount) throw new NotFoundException('Destination account not found');
      if (toAccount.userId !== userId) throw new ForbiddenException('Cross-user internal transfer requires p2p');
    }

    const totalDebit = settlementCents + quote.feeCents;
    if (fromAccount.balanceCents < totalDebit) {
      throw new BadRequestException('Insufficient funds');
    }

    const transferId = randomUUID();
    const pendingTxId = randomUUID();

    // Friendly description used both for the DB row and for the realtime
    // emit. Computed up here so the realtime payload after the prisma
    // transaction sees the same string the customer's transaction list
    // gets — a directional route ("Checking to Savings", "Checking to
    // Card •••• 6655") for account moves, "Wire transfer to Jane Doe" for
    // wires, instead of the generic "Transfer".
    const description = await this.describeTransfer(dto, fromAccount, toAccount);

    const transfer = await this.prisma.$transaction(async (tx) => {
      // Lock source account row (manual: requires raw query in Postgres).
      // Cast the parameter explicitly — without `::uuid` Postgres parses
      // the placeholder as text and refuses `uuid = text` comparisons
      // (PrismaClientKnownRequestError P2010 / SQLSTATE 42883).
      await tx.$executeRawUnsafe(
        `SELECT id FROM "Account" WHERE id = $1::uuid FOR UPDATE`,
        fromAccount.id,
      );

      const fresh = await tx.account.findUnique({ where: { id: fromAccount.id } });
      if (!fresh || fresh.balanceCents < totalDebit) throw new BadRequestException('Insufficient funds');

      await this.ledger.ensureAccountLedger(fromAccount.id, fromAccount.userId, tx);
      if (toAccount) await this.ledger.ensureAccountLedger(toAccount.id, toAccount.userId, tx);

      await this.ledger.post(tx, {
        description: `Transfer ${dto.kind} ${settlementCents}`,
        occurredAt: new Date(),
        source: `transfer:${transferId}:pending`,
        referenceId: transferId,
        postings: [
          {
            code: accountSubLedgerCode(fromAccount.id),
            direction: 'debit',
            amountCents: settlementCents,
          },
          {
            code: SYSTEM_LEDGER_CODES.PendingOut,
            direction: 'credit',
            amountCents: settlementCents,
          },
          ...(quote.feeCents > 0n ? [
            {
              code: accountSubLedgerCode(fromAccount.id),
              direction: 'debit' as const,
              amountCents: quote.feeCents,
            },
            {
              code: SYSTEM_LEDGER_CODES.FeeRevenue,
              direction: 'credit' as const,
              amountCents: quote.feeCents,
            },
          ] : []),
        ],
      });

      await tx.transaction.create({
        data: {
          id: pendingTxId,
          accountId: fromAccount.id,
          kind: KIND_TO_TX_KIND[dto.kind],
          status: TransactionStatus.pending,
          amountCents: -(settlementCents + quote.feeCents),
          description,
          category: 'transfer',
          note: dto.note,
          occurredAt: new Date(),
          metadata: { transferId, ...(fx ? { fx: this.fxPayload(fx) } : {}) },
        },
      });

      await tx.account.update({
        where: { id: fromAccount.id },
        data: { balanceCents: { decrement: totalDebit } },
      });

      // Review gate. Inbound (ach_in / wire_in) skip it since funds are
      // arriving. Held for admin approval regardless of amount:
      //   - every outbound wire (wire_out)
      //   - every transfer TO a linked account (ach_out)
      // Internal moves (checking ↔ savings) settle automatically; other
      // outbound transfers (p2p) use the configured review threshold.
      const isOutbound = dto.kind === 'p2p' || dto.kind === 'ach_out' || dto.kind === 'wire_out';
      const requiresReview =
        dto.kind === 'wire_out' ||
        dto.kind === 'ach_out' ||
        (isOutbound && settlementCents >= this.reviewThresholdCents);
      return tx.transfer.create({
        data: {
          id: transferId,
          kind: dto.kind,
          status: TransactionStatus.pending,
          fromAccountId: fromAccount.id,
          toAccountId: toAccount?.id ?? dto.toAccountId ?? null,
          externalRef: dto.externalRef,
          amountCents: settlementCents,
          feeCents: quote.feeCents,
          instant: !!dto.instant,
          initiatedByUserId: userId,
          idempotencyKey,
          pendingTransactionId: pendingTxId,
          ...(requiresReview ? { requiresReview: true } : {}),
        } as Prisma.TransferUncheckedCreateInput,
      });
    });

    // Read back the row so we know whether review was flagged. Saves us
    // from threading the flag through the closure return type.
    const heldForReview = ((transfer as unknown) as { requiresReview?: boolean })
      .requiresReview === true;

    this.events.emit(NEST_EVENT.TransactionCreated, {
      userId,
      accountId: fromAccount.id,
      transactionId: pendingTxId,
      amountCents: (-(settlementCents + quote.feeCents)).toString(),
      status: TransactionStatus.pending,
      at: new Date(),
      // Send the friendly fields too — without these the FE inserts the
      // row with a generic "Transfer" description and the customer sees
      // "transfer to RECIPIENT" until the next listTransactions refetch.
      description,
      category: 'transfer',
      kind: dto.kind,
      occurredAt: new Date().toISOString(),
    } satisfies NestTransactionCreatedPayload);

    const delayMs = dto.instant ? this.settleInstantMs : this.settleStandardMs;
    // When the transfer is flagged for review, do NOT enqueue settlement —
    // an admin will call /admin/transfers/:id/approve which is what
    // ultimately fires the worker. The debit + pending tx have already
    // committed so the customer's UI shows "pending" as expected.
    if (heldForReview) {
      this.events.emit('admin.queue.changed', { transferReviewDelta: 1 });
      return {
        transferId: transfer.id,
        status: transfer.status,
        pendingTransactionId: pendingTxId,
        feeCents: quote.feeCents.toString(),
        estimatedSettleMs: delayMs,
        fx: fx ? this.fxPayload(fx) : null,
      };
    }

    // Best-effort enqueue. If Redis is unreachable in dev, the transfer
    // row + pending tx + debit have all committed already — failing the
    // whole request would tell the customer their money didn't move
    // when it actually did. Surface a warning instead; a separate
    // sweeper job (or manual SQL) can settle orphaned pendings.
    let queued = false;
    try {
      await this.settlementQueue.add(
        'settle',
        { transferId },
        {
          delay: delayMs,
          jobId: `settle:${transferId}`,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
      queued = true;
    } catch (err) {
      this.logger.warn(
        `settlementQueue.add failed for transferId=${transferId}: ${(err as Error).message}. ` +
          `Falling back to inline setTimeout settlement.`,
      );
    }
    if (!queued) {
      // Dev fallback when Redis/BullMQ is unreachable: run the same
      // settlement code in-process after the configured delay. Production
      // should always have the queue available; this keeps the demo
      // usable without Redis.
      setTimeout(() => {
        void this.settlementWorker
          .process({ data: { transferId } } as Job<{ transferId: string }>)
          .catch((err) =>
            this.logger.error(
              `inline settlement failed for transferId=${transferId}: ${(err as Error).message}`,
            ),
          );
      }, delayMs);
    }

    return {
      transferId: transfer.id,
      status: transfer.status,
      pendingTransactionId: pendingTxId,
      feeCents: quote.feeCents.toString(),
      estimatedSettleMs: delayMs,
      fx: fx ? this.fxPayload(fx) : null,
    };
  }

  /**
   * Build a friendly, directional description for the transaction feed:
   *   internal → "Checking to Savings"
   *   ach_out  → "Checking to Card •••• 6655" / "Checking to Chase •••• 1234"
   *   ach_in   → "Card •••• 6655 to Checking"
   *   wire_out → "Wire transfer to {beneficiary}" (unchanged)
   * Falls back to the user's note, then a generic label. The user-typed
   * note is still persisted separately on the transaction's `note` column.
   */
  private async describeTransfer(
    dto: InitiateTransferDto,
    fromAccount: { label: string },
    toAccount: { label: string } | null,
  ): Promise<string> {
    if (dto.kind === 'internal' && toAccount) {
      return `${fromAccount.label} to ${toAccount.label}`;
    }

    const beneficiary = dto.wireDetails?.beneficiaryName?.trim();
    if (dto.kind === 'wire_out' && beneficiary) {
      return `Wire transfer to ${beneficiary}`;
    }

    if (dto.kind === 'ach_out' || dto.kind === 'ach_in') {
      const linkedLabel = await this.describeLinkedAccount(dto.externalRef);
      if (linkedLabel) {
        return dto.kind === 'ach_out'
          ? `${fromAccount.label} to ${linkedLabel}`
          : `${linkedLabel} to ${fromAccount.label}`;
      }
    }

    return dto.note ?? `Transfer (${dto.kind})`;
  }

  /**
   * Resolve the linked-account leg of an ACH transfer to a readable label.
   * The frontend packs it into externalRef as `linked:<id>:<institutionName>`.
   * We look the row up for the mask + type so cards read "Card •••• 6655";
   * if the row is gone we fall back to the institution name in the ref.
   */
  private async describeLinkedAccount(externalRef?: string): Promise<string | null> {
    if (!externalRef?.startsWith('linked:')) return null;
    const [, id, ...rest] = externalRef.split(':');
    const fallbackName = rest.join(':').trim();
    const linked = id
      ? await this.prisma.linkedAccount.findUnique({ where: { id } }).catch(() => null)
      : null;
    if (!linked) return fallbackName || null;
    const isCard =
      linked.institutionId.startsWith('card:') || /card|credit/i.test(linked.accountType);
    const base = isCard ? 'Card' : linked.institutionName;
    return linked.mask ? `${base} •••• ${linked.mask}` : base;
  }

  /**
   * Rescue path for transfers stuck in `pending` (Redis down at init time,
   * worker crashed, manual DB edits, etc). Resets the row to pending if
   * needed and enqueues a fresh settlement job — the same worker code
   * that normal transfers go through, so the ledger + recipient balance
   * + WS pushes all happen in lockstep.
   *
   * No elevation requirement: this is meant for ops / admin tools, not
   * a self-service customer action.
   */
  async forceSettle(transferId: string): Promise<{ transferId: string }> {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer) throw new Error(`Transfer ${transferId} not found`);

    // If someone hand-edited the row to 'posted' without running the
    // settlement worker, bounce it back to pending so the worker's
    // status check (which short-circuits on non-pending) actually fires.
    if (transfer.status !== TransactionStatus.pending) {
      await this.prisma.transfer.update({
        where: { id: transferId },
        data: {
          status: TransactionStatus.pending,
          settledAt: null,
          settledTransactionId: null,
        },
      });
    }

    // Drop any stale queued job for this transfer; otherwise the new
    // add() can be deduped by jobId.
    try {
      const existing = await this.settlementQueue.getJob(`settle:${transferId}`);
      if (existing) await existing.remove();
    } catch {
      /* job lookup is best-effort */
    }

    let queued = false;
    try {
      await this.settlementQueue.add(
        'settle',
        { transferId },
        {
          jobId: `settle:${transferId}`,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
      queued = true;
    } catch (err) {
      this.logger.warn(
        `forceSettle queue.add failed for ${transferId}: ${(err as Error).message}. Running settlement inline.`,
      );
    }
    if (!queued) {
      // Redis unreachable — run the worker code in-process immediately.
      // Same fallback path that `initiate()` uses when the queue is down.
      // We await so the caller (admin approve handler) sees the credit
      // already settled before it returns.
      await this.settlementWorker
        .process({ data: { transferId } } as Job<{ transferId: string }>)
        .catch((err) => {
          this.logger.error(
            `inline forceSettle failed for ${transferId}: ${(err as Error).message}`,
          );
          throw err;
        });
    }
    return { transferId };
  }

  async getForUser(userId: string, id: string): Promise<Transfer> {
    const t = await this.repo.findById(id);
    if (!t || t.initiatedByUserId !== userId) throw new NotFoundException('Transfer not found');
    return t;
  }

  list(userId: string) {
    return this.repo.listForUser(userId);
  }
}
