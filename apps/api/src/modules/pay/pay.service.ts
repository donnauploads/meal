import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { ContactsService } from '../contacts/contacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PayDto } from './dto/pay.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecipientHit {
  id: string;
  firstName: string | null;
  lastInitial: string | null;
  novaTag: string | null;
  avatarUrl: string | null;
  /** Last 4 of one of their checking accounts, when matched that way. */
  accountMask: string | null;
  /** True when this hit is the caller themselves (self-pay). */
  isSelf: boolean;
}

@Injectable()
export class PayService {
  private readonly logger = new Logger(PayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
    private readonly contacts: ContactsService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Resolve a recipient by exact UUID or @novaTag handle. Used by `pay()`.
   * Keep this strict (single match) — the fuzzy search lives in `search()`.
   */
  async resolveRecipient(handleOrId: string): Promise<User> {
    const raw = (handleOrId ?? '').trim();
    if (!raw) throw new NotFoundException('RECIPIENT_NOT_FOUND');

    // 1. UUID
    if (UUID_RE.test(raw)) {
      const u = await this.prisma.user.findUnique({ where: { id: raw } });
      if (u) return u;
    }
    // 2. novaTag (with or without leading @)
    const tag = raw.startsWith('@') ? raw : `@${raw}`;
    const byTag = await this.prisma.user.findUnique({ where: { novaTag: tag } });
    if (byTag) return byTag;
    // 3. email — matches the address stored on the user. Case-insensitive.
    if (raw.includes('@') && !raw.startsWith('@')) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email: { equals: raw, mode: 'insensitive' } },
      });
      if (byEmail) return byEmail;
    }
    // 4. phone — strip non-digits and match the E.164 suffix.
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 7) {
      const byPhone = await this.prisma.user.findFirst({
        where: { phoneE164: { endsWith: digits } },
      });
      if (byPhone) return byPhone;
    }
    throw new NotFoundException('RECIPIENT_NOT_FOUND');
  }

  /**
   * Fuzzy search across the user directory. Used by the /pay UI to find
   * someone by email, phone, novaTag, or last 4 of their checking account.
   * Excludes the caller from the results.
   */
  async search(callerId: string, raw: string): Promise<RecipientHit[]> {
    const q = (raw ?? '').trim();
    this.logger.log(`[recipients] caller=${callerId} q="${q}" len=${q.length}`);
    if (q.length < 2) return [];

    const digits = q.replace(/\D/g, '');
    const bareTag = q.replace(/^@/, '');
    const tag = q.startsWith('@') ? q : `@${q}`;

    const hits = await this.prisma.user.findMany({
      where: {
        status: 'active',
        // We intentionally INCLUDE the caller so they can pay themselves
        // (the modal routes self-pay to internal checking→savings).
        OR: [
          // Email: match anywhere (handles full address, local part, or a
          // partial), case-insensitive.
          { email: { contains: q, mode: 'insensitive' } },
          // Tag: with or without the leading @, exact or partial.
          { novaTag: { equals: tag, mode: 'insensitive' } },
          { novaTag: { contains: bareTag, mode: 'insensitive' } },
          // Name: let people search by first/last name too.
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          // Phone / account number: only when the query looks numeric
          // enough to avoid noisy matches.
          ...(digits.length >= 4
            ? [
                { phoneE164: { contains: digits } },
                {
                  accounts: {
                    some: {
                      type: 'checking' as const,
                      status: 'active' as const,
                      mockAccountNumber: { endsWith: digits },
                    },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        novaTag: true,
        avatarUrl: true,
        accounts: digits.length >= 4
          ? {
              where: {
                type: 'checking',
                status: 'active',
                mockAccountNumber: { endsWith: digits },
              },
              select: { mockAccountNumber: true },
              take: 1,
            }
          : false,
      },
      take: 20,
    });

    this.logger.log(`[recipients] q="${q}" matched ${hits.length} rows`);
    return hits.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastInitial: u.lastName ? u.lastName.charAt(0).toUpperCase() : null,
      novaTag: u.novaTag,
      avatarUrl: u.avatarUrl,
      accountMask:
        Array.isArray(u.accounts) && u.accounts[0]
          ? u.accounts[0].mockAccountNumber.slice(-4)
          : null,
      isSelf: u.id === callerId,
    }));
  }

  async pay(senderUserId: string, idempotencyKey: string, dto: PayDto) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header required');

    const recipient = await this.resolveRecipient(dto.recipientHandleOrId);

    const fromAccount = await this.prisma.account.findUnique({ where: { id: dto.fromAccountId } });
    if (!fromAccount || fromAccount.userId !== senderUserId) throw new ForbiddenException('Not your account');

    // Self-pay: route to the sender's own savings account as an internal
    // transfer rather than rejecting. Lets users move money to themselves
    // (e.g. checking → savings) from the Pay screen.
    if (recipient.id === senderUserId) {
      const savings = await this.prisma.account.findFirst({
        where: { userId: senderUserId, type: 'savings', status: 'active' },
      });
      if (!savings) throw new BadRequestException('No active savings account to receive funds');
      if (savings.id === fromAccount.id) throw new BadRequestException('Source and destination cannot match');
      const result = await this.transfers.initiate(senderUserId, idempotencyKey, {
        fromAccountId: fromAccount.id,
        toAccountId: savings.id,
        kind: 'internal',
        amountCents: dto.amountCents,
        instant: false,
        note: dto.note ?? '',
      });

      // Surface self-pays in /contacts/recents too. Best-effort, same as
      // the p2p path below: the transfer has already committed, so a
      // failure here must not 500 the payer. The contact resolves back to
      // this same user, so tapping it from Recents re-triggers a self-pay.
      const selfName =
        [recipient.firstName, recipient.lastName].filter(Boolean).join(' ').trim() ||
        recipient.novaTag ||
        recipient.email;
      if (dto.contactId) {
        try {
          await this.contacts.touch(senderUserId, dto.contactId);
        } catch (err) {
          this.logger.warn(
            `contacts.touch failed after self-pay; transferId=${result.transferId}: ${(err as Error).message}`,
          );
        }
      } else {
        try {
          await this.upsertRecentContact(senderUserId, recipient, selfName ?? null);
        } catch (err) {
          this.logger.warn(
            `recent contact upsert failed after self-pay; transferId=${result.transferId}: ${(err as Error).message}`,
          );
        }
      }

      return {
        ...result,
        recipient: { id: recipient.id, novaTag: recipient.novaTag, firstName: recipient.firstName },
      };
    }

    const recipientChecking = await this.prisma.account.findFirst({
      where: { userId: recipient.id, type: 'checking', status: 'active' },
    });
    if (!recipientChecking) throw new BadRequestException('Recipient has no active checking account');

    const result = await this.transfers.initiate(senderUserId, idempotencyKey, {
      fromAccountId: fromAccount.id,
      toAccountId: recipientChecking.id,
      kind: 'p2p',
      amountCents: dto.amountCents,
      instant: false,
      note: dto.note ?? '',
    });

    // Overwrite the sender's pending Transaction description with the
    // recipient name so the spending feed shows "Transfer to JANE DOE"
    // instead of the generic note-or-fallback. We keep the user-typed
    // `note` intact on the same row for the detail sheet.
    const recipientName =
      [recipient.firstName, recipient.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      recipient.novaTag ||
      recipient.email;
    if (result.pendingTransactionId && recipientName) {
      await this.prisma.transaction
        .update({
          where: { id: result.pendingTransactionId },
          data: { description: `Transfer to ${recipientName}` },
        })
        .catch((err) => {
          this.logger.warn(
            `failed to enrich pay description for tx ${result.pendingTransactionId}: ${(err as Error).message}`,
          );
        });
    }

    // The transfer has committed by now — the customer's money is moved
    // and the response shape is ready. The follow-on side effects below
    // (touching the contact row, creating the recipient notification)
    // are best-effort: if they throw, surfacing a 500 to the payer would
    // be misleading because the payment itself succeeded. Log + continue.
    if (dto.contactId) {
      try {
        await this.contacts.touch(senderUserId, dto.contactId);
      } catch (err) {
        this.logger.warn(
          `contacts.touch failed after pay; transferId=${result.transferId}: ${(err as Error).message}`,
        );
      }
    } else {
      // No explicit contactId — caller paid via search/handle. Find-or-
      // create a Contact row for this recipient so they surface in the
      // /contacts/recents feed next time.
      try {
        await this.upsertRecentContact(senderUserId, recipient, recipientName ?? null);
      } catch (err) {
        this.logger.warn(
          `recent contact upsert failed after pay; transferId=${result.transferId}: ${(err as Error).message}`,
        );
      }
    }

    try {
      const sender = await this.prisma.user.findUnique({
        where: { id: senderUserId },
        select: { firstName: true, lastName: true, novaTag: true },
      });
      const senderLabel =
        sender?.novaTag ??
        [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim() ??
        'A State Bank customer';
      const amountStr = formatCents(dto.amountCents);
      await this.notifications.create({
        userId: recipient.id,
        category: 'transaction',
        title: `You received ${amountStr}`,
        body: `${senderLabel} sent you ${amountStr}${dto.note ? ` — "${dto.note}"` : ''}.`,
        ctaUrl: '/home',
      });
    } catch (err) {
      this.logger.warn(
        `recipient notification failed after pay; transferId=${result.transferId}: ${(err as Error).message}`,
      );
    }

    return {
      ...result,
      recipient: { id: recipient.id, novaTag: recipient.novaTag, firstName: recipient.firstName },
    };
  }

  /**
   * Build the QR payload. Always returns a scannable link — when the user
   * hasn't picked a `novaTag` yet we fall back to their UUID, which
   * `resolveRecipient()` still accepts. `handle` is the human-readable
   * label shown below the QR (null when no tag is set, so the UI can
   * nudge the user to set one).
   */
  /**
   * Find-or-create a Contact row for a recipient the user just paid via
   * search. We match on (ownerUserId, novaTag) first, then email, then
   * phone — whichever the recipient has. Touching `lastUsedAt` is what
   * makes the row appear in /contacts/recents.
   */
  private async upsertRecentContact(
    ownerUserId: string,
    recipient: User,
    displayName: string | null,
  ): Promise<void> {
    const name = displayName?.trim() || recipient.novaTag || recipient.email || 'Unknown';
    const handle = recipient.novaTag ?? null;
    const email = recipient.email ?? null;
    const phoneE164 = recipient.phoneE164 ?? null;

    // Try to find an existing contact that matches one of the identity
    // fields. Avoids creating duplicate rows for the same recipient.
    const existing = await this.prisma.contact.findFirst({
      where: {
        ownerUserId,
        OR: [
          ...(handle ? [{ handle }] : []),
          ...(email ? [{ email }] : []),
          ...(phoneE164 ? [{ phoneE164 }] : []),
        ],
      },
    });

    if (existing) {
      await this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          lastUsedAt: new Date(),
          name: existing.name || name,
          handle: existing.handle ?? handle,
          email: existing.email ?? email,
          phoneE164: existing.phoneE164 ?? phoneE164,
          avatarUrl: existing.avatarUrl ?? recipient.avatarUrl ?? null,
        },
      });
      return;
    }

    await this.prisma.contact.create({
      data: {
        ownerUserId,
        name,
        handle,
        email,
        phoneE164,
        avatarUrl: recipient.avatarUrl ?? null,
        lastUsedAt: new Date(),
      },
    });
  }

  qrFor(novaTag: string | null, userId: string) {
    // Universal HTTPS link so any phone camera / generic QR scanner can open
    // it. The /pay page picks up `?to=<handle>` and pre-selects the
    // recipient. Configure APP_BASE in the API env to your public frontend
    // URL; falls back to localhost for dev.
    const appBase = (process.env.APP_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
    const target = novaTag ? `@${novaTag.replace(/^@/, '')}` : userId;
    return {
      handle: novaTag,
      qrData: `${appBase}/pay?to=${encodeURIComponent(target)}`,
    };
  }
}

function formatCents(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  const dollars = abs / 100n;
  const cents = abs % 100n;
  // Insert thousand separators into the dollar component. BigInt can
  // overflow Number, so we string-manipulate instead of toLocaleString.
  const dollarsWithCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollarsWithCommas}.${cents.toString().padStart(2, '0')}`;
}
