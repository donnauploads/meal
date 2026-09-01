import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PROVIDER, EmailProvider, TransactionalEmailInput } from './providers/email.provider.interface';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Override the From: identity (e.g. an admin desk address). */
  from?: string;
  /** Reply-To address — e.g. a per-thread inbound routing address. */
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  /** Extra RFC headers (e.g. `In-Reply-To`, `References`) for threading. */
  headers?: Record<string, string>;
  /**
   * Auth-critical mail (MFA codes, password resets, signup verification,
   * link OTPs) that must deliver even when an admin has switched off the
   * recipient's email notifications (User.emailNotificationsDisabled).
   * Leave unset for notification mail so the admin kill switch applies.
   */
  critical?: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly prisma: PrismaService,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    // Fire-and-forget. Holding the request thread on an SMTP socket (Gmail
    // can take 30–60s before it gives up) is what was making `/auth/login`
    // hang on slow / blocked networks. Errors are still logged.
    void this.deliver(msg).catch((err) => {
      this.logger.warn(`Email dispatch failed: ${(err as Error).message}`);
    });
  }

  async sendTransactional(
    input: TransactionalEmailInput & { critical?: boolean },
  ): Promise<{ messageId: string }> {
    const { critical, ...providerInput } = input;
    const to = await this.withoutSuppressed(providerInput.to, critical);
    if (to === null) return { messageId: 'suppressed' };
    return this.provider.send({ ...providerInput, to });
  }

  /**
   * Awaited send that returns the provider message id. Unlike `send`
   * (fire-and-forget for latency-sensitive auth flows), the admin mail
   * desk needs the returned id to persist + thread the conversation, so
   * it awaits delivery and lets errors propagate.
   */
  async sendAndReturn(msg: EmailMessage): Promise<{ messageId: string }> {
    const to = await this.withoutSuppressed(msg.to, msg.critical);
    if (to === null) return { messageId: 'suppressed' };
    return this.provider.send(this.toProviderInput({ ...msg, to }));
  }

  private async deliver(msg: EmailMessage): Promise<void> {
    const to = await this.withoutSuppressed(msg.to, msg.critical);
    if (to === null) return;
    await this.provider.send(this.toProviderInput({ ...msg, to }));
  }

  /**
   * Admin kill switch (User.emailNotificationsDisabled) — drops recipients
   * whose notifications an admin has switched off. Returns the remaining
   * recipients, or null when nobody is left to send to. `critical` mail
   * bypasses the check entirely, and a lookup failure fails open: a DB
   * hiccup must not take email delivery down with it.
   */
  private async withoutSuppressed(
    to: string | string[],
    critical?: boolean,
  ): Promise<string | string[] | null> {
    if (critical) return to;
    const list = Array.isArray(to) ? to : [to];
    const emails = list.map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!emails.length) return to;
    try {
      // Raw SQL: emailNotificationsDisabled isn't in the generated Prisma
      // client yet (same pattern as transfersDisabled).
      const rows = await this.prisma.$queryRaw<{ email: string }[]>`
        SELECT "email"
          FROM "User"
         WHERE "emailNotificationsDisabled" = true
           AND lower("email") IN (${Prisma.join(emails)})
      `;
      if (!rows.length) return to;
      const suppressed = new Set(rows.map((r) => r.email.toLowerCase()));
      const remaining = list.filter((e) => !suppressed.has(e.trim().toLowerCase()));
      this.logger.log(
        `Suppressed ${list.length - remaining.length} recipient(s) with email notifications disabled`,
      );
      if (!remaining.length) return null;
      return Array.isArray(to) ? remaining : remaining[0];
    } catch (err) {
      this.logger.warn(
        `Email suppression lookup failed (sending anyway): ${(err as Error).message}`,
      );
      return to;
    }
  }

  private toProviderInput(msg: EmailMessage): TransactionalEmailInput {
    return {
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      from: msg.from,
      replyTo: msg.replyTo,
      cc: msg.cc,
      bcc: msg.bcc,
      headers: msg.headers,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType ?? 'application/octet-stream',
        bytes: a.content,
      })),
    };
  }
}
