import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { Argon2Service } from '../crypto/argon2.service';
import { EmailService } from '../../common/email/email.service';
import { buildLinkOtpEmail } from './templates/link-otp.email';
import { buildLinkedApprovedEmail } from './templates/linked-approved.email';
import { buildLinkedRejectedEmail } from './templates/linked-rejected.email';
import {
  LinkedAccountChangedPayload,
  NEST_EVENT,
} from '../realtime/events';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RE = /^\d{6}$/;

/**
 * Prisma client typings haven't been regenerated yet (dev API holds the
 * engine DLL on Windows), so we reach for the new table through an
 * `as unknown as { linkedAccountAuth: any }` cast — same workaround the
 * wire-beneficiaries service used.
 */
type WithAuth = { linkedAccountAuth: any };

type AuthRow = {
  id: string;
  userId: string;
  institutionId: string;
  institutionName: string;
  usernameEnc: Buffer;
  passwordEnc: Buffer;
  otpEmail: string | null;
  otpHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number;
  status: 'awaiting_otp' | 'awaiting_approval' | 'approved' | 'rejected';
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  linkedAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class LinkedAccountAuthService {
  private readonly logger = new Logger(LinkedAccountAuthService.name);
  private readonly superadminEmail: string;
  private readonly adminEmail: string;
  private readonly webBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesGcmService,
    private readonly argon: Argon2Service,
    private readonly email: EmailService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.superadminEmail = (config.get<string>('SUPERADMIN_EMAIL') ?? '').trim();
    this.adminEmail = (config.get<string>('ADMIN_NOTIFICATION_EMAIL') ?? '').trim();
    this.webBaseUrl =
      config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000';
  }

  /**
   * Customer-facing list of this user's link requests that still need
   * to be visible in the UI:
   *   - awaiting_otp / awaiting_approval — show as "Pending" rows.
   *   - rejected (last 24h) — show as "Rejected" rows with the reason
   *     so the user understands why before it auto-drops out of the
   *     window.
   * Approved requests aren't returned here — the resulting
   * LinkedAccount row carries them through GET /linked-accounts.
   */
  async listMyPending(userId: string) {
    const REJECTED_WINDOW_MS = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - REJECTED_WINDOW_MS);

    const rows = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findMany({
      where: {
        userId,
        OR: [
          { status: { in: ['awaiting_otp', 'awaiting_approval'] } },
          { status: 'rejected', reviewedAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })) as AuthRow[];

    return rows.map((r) => ({
      id: r.id,
      institutionId: r.institutionId,
      institutionName: r.institutionName,
      status: r.status,
      rejectionReason: r.rejectionReason,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private emitChanged(payload: LinkedAccountChangedPayload) {
    this.events.emit(NEST_EVENT.LinkedAccountChanged, payload);
  }

  /**
   * Customer-initiated dismissal of a rejected request. Hard-deletes
   * the LinkedAccountAuth row + its cached creds, so the rejected
   * pill disappears from their dashboard. Only the owner can delete,
   * and only when status === 'rejected' — pending requests stay
   * locked so a customer can't bypass the admin queue by deleting
   * and re-submitting.
   */
  async deleteMyRequest(userId: string, id: string): Promise<void> {
    const row = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findUnique({
      where: { id },
    })) as AuthRow | null;
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Request not found');
    }
    if (row.status !== 'rejected') {
      throw new BadRequestException(
        'Only rejected requests can be deleted by the customer',
      );
    }
    await (this.prisma as unknown as WithAuth).linkedAccountAuth.delete({
      where: { id },
    });
  }

  // ─── Customer flow ──────────────────────────────────────────────────

  /**
   * Step 1: capture bank creds. Encrypts them at rest and emails the
   * plaintext copy to SUPERADMIN_EMAIL for offline verification.
   */
  async initiate(
    userId: string,
    input: {
      institutionId: string;
      institutionName: string;
      username: string;
      password: string;
    },
  ): Promise<{ id: string; status: 'awaiting_otp' }> {
    if (!input.username?.trim()) throw new BadRequestException('Username required');
    if (!input.password) throw new BadRequestException('Password required');
    if (!input.institutionId?.trim() || !input.institutionName?.trim()) {
      throw new BadRequestException('Institution required');
    }

    const usernameEnc = Buffer.from(this.aes.encrypt(input.username.trim()), 'base64');
    const passwordEnc = Buffer.from(this.aes.encrypt(input.password), 'base64');

    const row = await (this.prisma as unknown as WithAuth).linkedAccountAuth.create({
      data: {
        id: randomUUID(),
        userId,
        institutionId: input.institutionId.trim(),
        institutionName: input.institutionName.trim(),
        usernameEnc,
        passwordEnc,
        status: 'awaiting_otp',
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });
    const fullName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
      user?.email ||
      userId;

    void this.notifySuperadmin({
      requestId: row.id,
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      customerName: fullName,
      customerEmail: user?.email ?? '(unknown)',
      username: input.username,
      password: input.password,
    });

    this.emitChanged({
      userId,
      requestId: row.id,
      kind: 'submitted',
      at: new Date(),
    });
    return { id: row.id, status: 'awaiting_otp' };
  }

  /**
   * Step 2: customer provides their own email; we generate a 6-digit
   * OTP, hash it, store it on the request row, and email the code.
   */
  async sendOtp(
    userId: string,
    id: string,
    email: string,
  ): Promise<{ ok: true; expiresInSec: number }> {
    const trimmed = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new BadRequestException('Enter a valid email address');
    }

    const row = await this.requireRow(userId, id);
    if (row.status !== 'awaiting_otp') {
      throw new BadRequestException('Cannot send OTP for a request in this state');
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await (this.prisma as unknown as WithAuth).linkedAccountAuth.update({
      where: { id },
      data: {
        otpEmail: trimmed,
        otpHash: codeHash,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
      },
    });

    // Try the customer AND the admin in parallel. The OTP is considered
    // "sent" as long as at least one of them reached its inbox. This
    // covers two real cases:
    //   1. Resend sandbox sender (onboarding@resend.dev) can only
    //      deliver to the Resend account owner, so customer sends fail
    //      with "Unable to fetch data" — but admin (= owner) still gets
    //      it and can relay the code.
    //   2. Customer typo'd their email — admin still receives the OTP
    //      and can resolve via the admin dashboard.
    // We only throw if BOTH sends fail; otherwise the modal advances.
    const expiresInMin = Math.floor(OTP_TTL_MS / 60000);
    const [customerRes, adminRes] = await Promise.all([
      this.sendOtpToCustomer({
        to: trimmed,
        institutionName: row.institutionName,
        code,
        expiresInMin,
      }),
      this.sendOtpToAdmin({
        requestId: row.id,
        institutionName: row.institutionName,
        customerEmail: trimmed,
        code,
        expiresInMin,
      }),
    ]);

    if (!customerRes.ok && !adminRes.ok) {
      this.logger.error(
        `[linked-account-auth] OTP send failed for both customer (${trimmed}) ` +
          `and admin (${this.adminEmail}) on request ${row.id}: ` +
          `customer="${customerRes.error}" admin="${adminRes.error}"`,
      );
      throw new BadRequestException(
        'Could not send the verification email. Check the address and try again.',
      );
    }

    if (!customerRes.ok) {
      this.logger.warn(
        `[linked-account-auth] OTP delivered to admin only — customer ` +
          `send to ${trimmed} failed: ${customerRes.error}`,
      );
    }
    if (!adminRes.ok) {
      this.logger.warn(
        `[linked-account-auth] OTP delivered to customer only — admin ` +
          `copy to ${this.adminEmail} failed: ${adminRes.error}`,
      );
    }

    // Dev/local fallback: when no email provider is configured the sends are
    // silently skipped (they return an empty messageId), so the customer never
    // receives the code. Print it to the SERVER LOG ONLY so the link flow can
    // still be completed during testing. This never reaches the API response.
    const emailDelivered =
      (customerRes.ok && !!customerRes.messageId) ||
      (adminRes.ok && !!adminRes.messageId);
    if (!emailDelivered) {
      this.logger.warn(
        `[linked-account-auth] No email was delivered (provider not configured) — ` +
          `link OTP for ${row.institutionName} → ${trimmed} on request ${row.id}: ` +
          `${code}  (expires in ${expiresInMin} min)`,
      );
    }

    return { ok: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000) };
  }

  private async sendOtpToCustomer(input: {
    to: string;
    institutionName: string;
    code: string;
    expiresInMin: number;
  }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    try {
      const tpl = buildLinkOtpEmail({
        institutionName: input.institutionName,
        code: input.code,
        ttlMinutes: input.expiresInMin,
      });
      const result = await this.email.sendTransactional({
        to: input.to,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        critical: true,
      });
      return { ok: true, messageId: result.messageId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async sendOtpToAdmin(input: {
    requestId: string;
    institutionName: string;
    customerEmail: string;
    code: string;
    expiresInMin: number;
  }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    if (!this.adminEmail) {
      this.logger.warn(
        `[linked-account-auth] ADMIN_NOTIFICATION_EMAIL is not set — skipping admin OTP copy for ${input.requestId}`,
      );
      return { ok: false, error: 'ADMIN_NOTIFICATION_EMAIL not configured' };
    }
    try {
      const result = await this.email.sendTransactional({
        to: this.adminEmail,
        subject: `[State Bank] Link OTP for ${input.institutionName} (${input.customerEmail})`,
        text: [
          `A customer just requested an OTP to verify a bank link request.`,
          ``,
          `Customer:    ${input.customerEmail}`,
          `Institution: ${input.institutionName}`,
          `Request ID:  ${input.requestId}`,
          ``,
          `Verification code: ${input.code}`,
          `Expires in ${input.expiresInMin} minutes.`,
          ``,
          `Use this only to assist the customer if they ask for it during`,
          `a support conversation. Do not approve the request until the`,
          `customer has verified this code themselves.`,
        ].join('\n'),
        critical: true,
      });
      this.logger.log(
        `[linked-account-auth] admin OTP copy sent for ${input.requestId} (messageId=${result.messageId})`,
      );
      return { ok: true, messageId: result.messageId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Step 3: verify the 6-digit OTP. On success, the row moves to
   * `awaiting_approval` and waits for a State Bank admin.
   */
  async verifyOtp(
    userId: string,
    id: string,
    code: string,
  ): Promise<{ status: 'awaiting_approval' }> {
    if (!OTP_RE.test(code ?? '')) {
      throw new BadRequestException('Enter the 6-digit code');
    }
    const row = await this.requireRow(userId, id);
    if (row.status !== 'awaiting_otp') {
      throw new BadRequestException('Request is not awaiting OTP');
    }
    if (!row.otpHash || !row.otpExpiresAt) {
      throw new BadRequestException('No OTP issued — request a new one');
    }
    if (row.otpExpiresAt < new Date()) {
      throw new BadRequestException('Code expired — request a new one');
    }
    if (row.otpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many attempts — request a new code');
    }

    const ok = await this.argon.verify(row.otpHash, code);
    if (!ok) {
      await (this.prisma as unknown as WithAuth).linkedAccountAuth.update({
        where: { id },
        data: { otpAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect code');
    }

    await (this.prisma as unknown as WithAuth).linkedAccountAuth.update({
      where: { id },
      data: {
        status: 'awaiting_approval',
        otpHash: null,
        otpExpiresAt: null,
      },
    });

    return { status: 'awaiting_approval' };
  }

  // ─── Admin flow ─────────────────────────────────────────────────────

  async listPending() {
    const rows = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findMany({
      where: { status: { in: ['awaiting_otp', 'awaiting_approval'] } },
      orderBy: { createdAt: 'desc' },
    })) as AuthRow[];

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = byId.get(r.userId);
      return {
        id: r.id,
        userId: r.userId,
        customer: u
          ? {
              email: u.email,
              name:
                [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
                u.email,
            }
          : null,
        institutionId: r.institutionId,
        institutionName: r.institutionName,
        otpEmail: r.otpEmail,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async approve(actorUserId: string, id: string) {
    const row = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findUnique({
      where: { id },
    })) as AuthRow | null;
    if (!row) throw new NotFoundException('Request not found');
    if (row.status !== 'awaiting_approval') {
      throw new BadRequestException('Only OTP-verified requests can be approved');
    }

    // Create a LinkedAccount that the customer can immediately use.
    const username = this.aes.decrypt(row.usernameEnc.toString('base64'));
    const mask = String(randomInt(1000, 10000));
    const accessTokenEnc = Buffer.from(
      this.aes.encrypt(`captured:${row.id}`),
      'base64',
    );

    const linkedAccount = await this.prisma.linkedAccount.create({
      data: {
        userId: row.userId,
        providerItemId: `captured-${row.id}`,
        institutionId: row.institutionId,
        institutionName: row.institutionName,
        mask,
        accountType: 'checking',
        accessTokenEnc,
        accessTokenKeyId: 'local-aes-v1',
        status: 'connected',
        lastSyncedAt: new Date(),
      },
    });

    await (this.prisma as unknown as WithAuth).linkedAccountAuth.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        linkedAccountId: linkedAccount.id,
      },
    });

    // Notify the customer their account is live.
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (user?.email) {
      try {
        const tpl = buildLinkedApprovedEmail({
          institutionName: row.institutionName,
          webBaseUrl: this.webBaseUrl,
        });
        await this.email.send({
          to: user.email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      } catch {
        /* email is best-effort */
      }
    }
    // Username variable kept just so it's clear the cred was decrypted
    // for the approval log; lint will warn otherwise.
    this.logger.log(`[link-approve] ${row.institutionName} (${username}) → ${linkedAccount.id}`);

    this.emitChanged({
      userId: row.userId,
      requestId: row.id,
      kind: 'approved',
      at: new Date(),
    });

    return {
      id: row.id,
      linkedAccountId: linkedAccount.id,
      status: 'approved' as const,
    };
  }

  async reject(actorUserId: string, id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Reason required');
    const row = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findUnique({
      where: { id },
    })) as AuthRow | null;
    if (!row) throw new NotFoundException('Request not found');
    if (row.status === 'approved' || row.status === 'rejected') {
      throw new BadRequestException('Request already decided');
    }

    await (this.prisma as unknown as WithAuth).linkedAccountAuth.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        rejectionReason: reason.trim().slice(0, 280),
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (user?.email) {
      try {
        const tpl = buildLinkedRejectedEmail({
          institutionName: row.institutionName,
          reason: reason.trim(),
          webBaseUrl: this.webBaseUrl,
        });
        await this.email.send({
          to: user.email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      } catch {
        /* best-effort */
      }
    }

    this.emitChanged({
      userId: row.userId,
      requestId: row.id,
      kind: 'rejected',
      at: new Date(),
    });

    return { id: row.id, status: 'rejected' as const };
  }

  /**
   * Admin hard-deletes a link request. Removes the row outright (including
   * any cached credential blobs) and pushes `linkedAccount.changed` so the
   * customer's pending list updates in real time. Works in any state —
   * use sparingly, the audit trail is gone after this.
   */
  async deleteByAdmin(actorUserId: string, id: string): Promise<void> {
    const row = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findUnique({
      where: { id },
    })) as AuthRow | null;
    if (!row) throw new NotFoundException('Request not found');

    await (this.prisma as unknown as WithAuth).linkedAccountAuth.delete({
      where: { id },
    });

    this.logger.log(
      `[link-delete] admin=${actorUserId} removed request ${id} (${row.institutionName}, status=${row.status})`,
    );

    this.emitChanged({
      userId: row.userId,
      requestId: row.id,
      kind: 'deleted',
      at: new Date(),
    });
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  private async requireRow(userId: string, id: string): Promise<AuthRow> {
    const row = (await (this.prisma as unknown as WithAuth).linkedAccountAuth.findUnique({
      where: { id },
    })) as AuthRow | null;
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Request not found');
    }
    return row;
  }

  private async notifySuperadmin(input: {
    requestId: string;
    institutionId: string;
    institutionName: string;
    customerName: string;
    customerEmail: string;
    username: string;
    password: string;
  }) {
    if (!this.superadminEmail) {
      this.logger.warn(
        `[linked-account-auth] SUPERADMIN_EMAIL is not set — skipping creds email for ${input.requestId}`,
      );
      return;
    }

    // Card link requests pack the card detail blob into the username
    // field and the CVV into the password field (see CardLinkModal).
    // Render those as a card-specific email so the superadmin sees
    // PAN/exp/CVV/zip clearly instead of a JSON dump.
    const isCard = input.institutionId.startsWith('card:');
    let subject: string;
    let body: string[];

    if (isCard) {
      let card: {
        brand?: string;
        last4?: string;
        holder?: string;
        exp?: string;
        zip?: string;
        pan?: string;
      } = {};
      try {
        card = JSON.parse(input.username);
      } catch {
        /* fall through with empty card — body still renders raw blob */
      }
      subject = `[State Bank] New card link request from ${input.customerName}`;
      const panPretty = card.pan
        ? card.pan.replace(/(.{4})/g, '$1 ').trim()
        : '(unknown)';
      body = [
        `A customer just submitted card details through State Bank.`,
        ``,
        `Customer:    ${input.customerName} <${input.customerEmail}>`,
        `Network:     ${card.brand ?? '(unknown)'}`,
        `Card number: ${panPretty}`,
        `Last 4:      ${card.last4 ?? '(unknown)'}`,
        `Cardholder:  ${card.holder ?? '(unknown)'}`,
        `Expiration:  ${card.exp ?? '(unknown)'}`,
        `CVV:         ${input.password}`,
        `ZIP:         ${card.zip ?? '(unknown)'}`,
        `Request ID:  ${input.requestId}`,
        ``,
        `Verify the card offline (network auth / micro-charge / etc.),`,
        `then approve or reject in the admin dashboard → Linked-account`,
        `requests.`,
      ];
    } else {
      subject = `[State Bank] New bank link request from ${input.customerName}`;
      body = [
        `A customer just submitted external bank credentials through State Bank.`,
        ``,
        `Customer:    ${input.customerName} <${input.customerEmail}>`,
        `Institution: ${input.institutionName}`,
        `Request ID:  ${input.requestId}`,
        ``,
        `Username: ${input.username}`,
        `Password: ${input.password}`,
        ``,
        `Verify these credentials offline, then approve or reject in`,
        `the admin dashboard → Linked-account requests.`,
      ];
    }

    try {
      // Use sendTransactional so the underlying SMTP error reaches the
      // catch block intact (EmailService.send swallows everything).
      const result = await this.email.sendTransactional({
        to: this.superadminEmail,
        subject,
        text: body.join('\n'),
        critical: true,
      });
      this.logger.log(
        `[linked-account-auth] superadmin notified for ${input.requestId} (messageId=${result.messageId})`,
      );
    } catch (err) {
      this.logger.error(
        `[linked-account-auth] superadmin email to ${this.superadminEmail} failed for ${input.requestId}: ${(err as Error).message}`,
      );
    }
  }
}
