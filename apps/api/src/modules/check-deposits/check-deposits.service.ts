import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionCategory, TransactionKind, TransactionStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { STORAGE_DRIVER, StorageDriver } from '../documents/storage/storage.interface';
import { NEST_EVENT, NestAccountBalanceChangedPayload, NestTransactionCreatedPayload } from '../realtime/events';
import { buildCheckDepositDecisionApprovedEmail } from './templates/check-deposit-decision-approved.email';
import { buildCheckDepositDecisionDeclinedEmail } from './templates/check-deposit-decision-declined.email';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB per side

export interface SubmitCheckInput {
  userId: string;
  amountCents: bigint;
  /** The amount + currency the customer entered on the form (display
   *  currency). `amountCents` is the USD ledger value; these preserve the
   *  exact figure they saw so decision emails match it. */
  displayAmountCents?: bigint | null;
  displayCurrency?: string | null;
  front: { contentType: string; bytes: Buffer; originalName?: string };
  back: { contentType: string; bytes: Buffer; originalName?: string };
}

export interface SubmitCheckResult {
  id: string;
  amountCents: string;
  submittedAt: string;
  status: 'pending_review';
}

@Injectable()
export class CheckDepositsService {
  private readonly logger = new Logger(CheckDepositsService.name);
  private readonly maxBytes: number;

  constructor(
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.maxBytes = Number(
      this.config.get('CHECK_DEPOSIT_MAX_BYTES') ?? DEFAULT_MAX_BYTES,
    );
  }

  async submit(input: SubmitCheckInput): Promise<SubmitCheckResult> {
    this.validateImage('front', input.front);
    this.validateImage('back', input.back);
    if (input.amountCents <= 0n) {
      throw new BadRequestException('Amount must be positive');
    }
    // Matches the frontend's advertised cap. Every deposit (any amount up to
    // this) is held for admin approval — there is no auto-approval path.
    if (input.amountCents > 50_000_000n) {
      throw new BadRequestException('Amount exceeds mobile-deposit limit ($500,000)');
    }

    // Resolve the customer's primary checking account — that's where the
    // funds land on approval. If there's no checking account, no point
    // accepting the deposit.
    const checking = await this.prisma.account.findFirst({
      where: { userId: input.userId, type: 'checking' },
      select: { id: true },
    });
    if (!checking) {
      throw new BadRequestException(
        'No checking account is set up to receive the deposit.',
      );
    }

    const id = randomUUID();
    const submittedAt = new Date();
    const frontKey = await this.storeSide(input.userId, id, 'front', input.front);
    const backKey = await this.storeSide(input.userId, id, 'back', input.back);

    // Persist the deposit so the admin queue can show it and the approval
    // workflow can credit funds + emit live events.
    await (this.prisma as unknown as { checkDeposit: { create: (a: unknown) => Promise<unknown> } }).checkDeposit.create({
      data: {
        id,
        userId: input.userId,
        accountId: checking.id,
        amountCents: input.amountCents,
        displayAmountCents: input.displayAmountCents ?? null,
        displayCurrency: input.displayCurrency ?? null,
        frontKey,
        backKey,
        submittedAt,
        status: 'pending',
      },
    });

    // Email is fire-and-forget — failure shouldn't block the customer
    // confirmation. EmailService already swallows + logs provider errors.
    void this.notifyAdmins({ id, submittedAt, ...input, frontKey, backKey });

    this.logger.log(
      `Check deposit ${id} submitted by user ${input.userId} for ${input.amountCents}¢`,
    );

    return {
      id,
      amountCents: input.amountCents.toString(),
      submittedAt: submittedAt.toISOString(),
      status: 'pending_review',
    };
  }

  private validateImage(
    side: 'front' | 'back',
    img: { contentType: string; bytes: Buffer },
  ): void {
    if (!img || !img.bytes || img.bytes.length === 0) {
      throw new BadRequestException(`${side} image is required`);
    }
    if (!ALLOWED_MIME.has(img.contentType)) {
      throw new BadRequestException(
        `${side} image must be JPEG, PNG, or WebP (got ${img.contentType})`,
      );
    }
    if (img.bytes.length > this.maxBytes) {
      throw new BadRequestException(
        `${side} image exceeds ${(this.maxBytes / (1024 * 1024)).toFixed(1)} MB`,
      );
    }
  }

  private async storeSide(
    userId: string,
    depositId: string,
    side: 'front' | 'back',
    img: { contentType: string; bytes: Buffer },
  ): Promise<string> {
    const ext =
      img.contentType === 'image/png' ? 'png'
      : img.contentType === 'image/webp' ? 'webp'
      : 'jpg';
    const key = `user/${userId}/check-deposits/${depositId}-${side}.${ext}`;
    await this.storage.put({ key, body: img.bytes, contentType: img.contentType });
    return key;
  }

  private async notifyAdmins(args: {
    id: string;
    submittedAt: Date;
    userId: string;
    amountCents: bigint;
    front: { contentType: string; bytes: Buffer };
    back: { contentType: string; bytes: Buffer };
    frontKey: string;
    backKey: string;
  }): Promise<void> {
    const recipients = (
      this.config.get<string>('ADMIN_CHECK_DEPOSIT_EMAIL') ??
      this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ??
      ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      this.logger.warn(
        `Check deposit ${args.id}: no admin recipients configured ` +
          `(set ADMIN_CHECK_DEPOSIT_EMAIL or ADMIN_NOTIFICATION_EMAIL).`,
      );
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: args.userId },
      select: { firstName: true, lastName: true, email: true, novaTag: true },
    });
    const customerLabel =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
      user?.novaTag ||
      args.userId;
    const amountStr = formatCents(args.amountCents);
    const reference = formatDepositRef(args.id);
    // Lead with the friendly reference number — same string the customer
    // sees on their success screen, so support emails / replies can be
    // cross-referenced without anyone reading raw UUIDs.
    const subject = `[State Bank] Check deposit ${reference} pending review — ${amountStr} from ${customerLabel}`;
    const lines = [
      'A customer submitted a mobile check deposit for review.',
      '',
      `Reference:     ${reference}`,
      `Deposit ID:    ${args.id}`,
      `Customer:      ${customerLabel}`,
      `Customer ID:   ${args.userId}`,
      user?.email ? `Email:         ${user.email}` : '',
      user?.novaTag ? `Handle:        ${user.novaTag}` : '',
      `Amount:        ${amountStr}`,
      `Submitted at:  ${args.submittedAt.toISOString()}`,
      '',
      'Both sides of the check are attached. Review and either credit',
      'the customer\'s checking account or reject with a reason.',
    ].filter(Boolean);

    // Send to each recipient INDIVIDUALLY rather than as one batched
    // To-list. The Resend sandbox sender (`onboarding@resend.dev`) can
    // only deliver to the account-owner address — a multi-recipient
    // batch that contains a single non-owner address fails the whole
    // send with "Unable to fetch data". Splitting the fan-out lets the
    // valid recipients still receive the email, and logs which one
    // failed instead of "the email." Use sendTransactional so the
    // provider error reaches our catch block intact (email.send fire-
    // and-forgets).
    const attachments = [
      {
        filename: `check-${args.id}-front.${extOf(args.front.contentType)}`,
        contentType: args.front.contentType,
        bytes: args.front.bytes,
      },
      {
        filename: `check-${args.id}-back.${extOf(args.back.contentType)}`,
        contentType: args.back.contentType,
        bytes: args.back.bytes,
      },
    ];
    const results = await Promise.allSettled(
      recipients.map((to) =>
        this.email.sendTransactional({
          to,
          subject,
          text: lines.join('\n'),
          attachments,
        }),
      ),
    );
    results.forEach((r, i) => {
      const to = recipients[i]!;
      if (r.status === 'fulfilled') {
        this.logger.log(
          `Check deposit ${args.id}: notified ${to} (messageId=${r.value.messageId})`,
        );
      } else {
        this.logger.warn(
          `Check deposit ${args.id}: notify to ${to} failed: ${
            (r.reason as Error).message
          }`,
        );
      }
    });
  }

  // ─── Admin queue ────────────────────────────────────────────────────────

  /** Pending deposits awaiting an admin decision, newest first. */
  async listForAdmin(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') {
    const where = status === 'all' ? {} : { status };
    const rows = await (this.prisma as unknown as {
      checkDeposit: { findMany: (a: unknown) => Promise<CheckDepositRow[]> };
    }).checkDeposit.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 100,
    });

    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true, novaTag: true, avatarUrl: true },
    });
    const byUser = new Map(users.map((u) => [u.id, u]));

    return Promise.all(
      rows.map(async (r) => {
        const u = byUser.get(r.userId);
        const customerName =
          [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() ||
          u?.novaTag ||
          u?.email ||
          r.userId;
        return {
          id: r.id,
          reference: formatDepositRef(r.id),
          userId: r.userId,
          customerName,
          customerEmail: u?.email ?? null,
          customerNovaTag: u?.novaTag ?? null,
          customerAvatarUrl: u?.avatarUrl ?? null,
          accountId: r.accountId,
          amountCents: r.amountCents.toString(),
          status: r.status,
          submittedAt: r.submittedAt.toISOString(),
          decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
          decisionReason: r.decisionReason,
          // Presigned download URLs (1 hour) so the admin UI can <img> them
          // without proxying bytes through the API.
          frontUrl: await this.storage
            .getPresignedDownloadUrl(r.frontKey, 60 * 60)
            .catch(() => null),
          backUrl: await this.storage
            .getPresignedDownloadUrl(r.backKey, 60 * 60)
            .catch(() => null),
        };
      }),
    );
  }

  /**
   * Email the customer the outcome of the admin review — for BOTH approved
   * and rejected. The amount shown is the figure they entered on the form
   * (display currency), falling back to the USD ledger amount for older
   * deposits saved before that was captured. Best-effort and non-blocking.
   */
  private async sendDecisionEmail(
    row: CheckDepositRow,
    decision: 'approved' | 'rejected',
    opts: { reason?: string; accountLabel?: string } = {},
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { email: true, firstName: true },
      });
      if (!user?.email) return;

      const webBaseUrl =
        this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000';
      const cents = row.displayAmountCents ?? row.amountCents;
      const currency = row.displayCurrency ?? 'USD';
      const amount = (Number(cents) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const mail =
        decision === 'approved'
          ? buildCheckDepositDecisionApprovedEmail({
              firstName: user.firstName,
              amount,
              currency,
              accountLabel: opts.accountLabel ?? 'your checking account',
              approvedAt: new Date(),
              webBaseUrl,
            })
          : buildCheckDepositDecisionDeclinedEmail({
              firstName: user.firstName,
              amount,
              currency,
              reason: opts.reason?.trim() || 'Declined after review',
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
        `check deposit decision email failed for ${row.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Credits the user's checking account with the deposit amount: writes a
   * Transaction row (kind=deposit, status=posted), bumps balanceCents,
   * and emits the same realtime events the regular transfer flow uses so
   * the customer screen updates without a refresh.
   */
  async approve(adminUserId: string, depositId: string) {
    const row = await (this.prisma as unknown as {
      checkDeposit: { findUnique: (a: unknown) => Promise<CheckDepositRow | null> };
    }).checkDeposit.findUnique({ where: { id: depositId } });
    if (!row) throw new NotFoundException('Deposit not found');
    if (row.status !== 'pending') {
      throw new ConflictException(`Deposit already ${row.status}`);
    }

    const account = await this.prisma.account.findUnique({ where: { id: row.accountId } });
    if (!account) throw new NotFoundException('Destination account no longer exists');

    const result = await this.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: TransactionKind.deposit,
          status: TransactionStatus.posted,
          amountCents: row.amountCents,
          description: 'Mobile check deposit',
          category: TransactionCategory.income,
          occurredAt: new Date(),
          postedAt: new Date(),
        },
      });
      await tx.account.update({
        where: { id: account.id },
        data: { balanceCents: { increment: row.amountCents } },
      });
      await (tx as unknown as { checkDeposit: { update: (a: unknown) => Promise<unknown> } })
        .checkDeposit.update({
          where: { id: depositId },
          data: {
            status: 'approved',
            decidedAt: new Date(),
            decidedByUserId: adminUserId,
            transactionId: txn.id,
          },
        });
      return txn;
    });

    // Live push to the customer: row appears on home + spending, balance
    // chip reflows on the savings/home views.
    this.events.emit(NEST_EVENT.TransactionCreated, {
      userId: row.userId,
      accountId: account.id,
      transactionId: result.id,
      amountCents: row.amountCents.toString(),
      status: TransactionStatus.posted,
      at: new Date(),
      description: 'Mobile check deposit',
      category: TransactionCategory.income,
      occurredAt: result.occurredAt.toISOString(),
      kind: TransactionKind.deposit,
    } satisfies NestTransactionCreatedPayload);

    const fresh = await this.prisma.account.findUnique({ where: { id: account.id } });
    if (fresh) {
      this.events.emit(NEST_EVENT.AccountBalanceChanged, {
        userId: row.userId,
        accountId: fresh.id,
        balanceCents: fresh.balanceCents.toString(),
        at: new Date(),
      } satisfies NestAccountBalanceChangedPayload);
    }

    await this.sendDecisionEmail(row, 'approved', {
      accountLabel: account.label,
    });

    return { id: depositId, status: 'approved' as const, transactionId: result.id };
  }

  async reject(adminUserId: string, depositId: string, reason: string) {
    const row = await (this.prisma as unknown as {
      checkDeposit: { findUnique: (a: unknown) => Promise<CheckDepositRow | null> };
    }).checkDeposit.findUnique({ where: { id: depositId } });
    if (!row) throw new NotFoundException('Deposit not found');
    if (row.status !== 'pending') {
      throw new ConflictException(`Deposit already ${row.status}`);
    }
    await (this.prisma as unknown as {
      checkDeposit: { update: (a: unknown) => Promise<unknown> };
    }).checkDeposit.update({
      where: { id: depositId },
      data: {
        status: 'rejected',
        decidedAt: new Date(),
        decidedByUserId: adminUserId,
        decisionReason: reason,
      },
    });

    await this.sendDecisionEmail(row, 'rejected', { reason });
    return { id: depositId, status: 'rejected' as const };
  }
}

interface CheckDepositRow {
  id: string;
  userId: string;
  accountId: string;
  amountCents: bigint;
  displayAmountCents: bigint | null;
  displayCurrency: string | null;
  status: 'pending' | 'approved' | 'rejected';
  frontKey: string;
  backKey: string;
  submittedAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decisionReason: string | null;
  transactionId: string | null;
}

/** Friendly per-deposit reference, derived from the raw UUID. Same shape
 *  the customer success screen renders so the two stay in lockstep. */
export function formatDepositRef(id: string): string {
  const hex = id.replace(/-/g, '').toUpperCase();
  return `CHK-${hex.slice(0, 8)}`;
}

function formatCents(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  const dollars = abs / 100n;
  const cents = abs % 100n;
  return `${sign}$${dollars.toString()}.${cents.toString().padStart(2, '0')}`;
}

function extOf(ct: string): string {
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  return 'jpg';
}
