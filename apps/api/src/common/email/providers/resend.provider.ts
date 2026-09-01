import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailProvider, TransactionalEmailInput } from './email.provider.interface';

/**
 * HTTPS-based mail provider. Lives on port 443 so it works from every
 * managed host (Railway, Render, Fly, Vercel functions) — no SMTP egress
 * required. Reads:
 *
 *   RESEND_API_KEY  — required. Get from resend.com → API Keys.
 *   RESEND_FROM     — From: address. Must be on a verified Resend
 *                     domain. Falls back to SMTP_FROM, then to
 *                     'State Bank <onboarding@resend.dev>' which Resend
 *                     accepts for *test* sends to the account owner
 *                     only.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('RESEND_API_KEY');
    this.from =
      config.get<string>('RESEND_FROM') ??
      config.get<string>('SMTP_FROM') ??
      'State Bank <onboarding@resend.dev>';

    if (!key) {
      this.logger.warn(
        'RESEND_API_KEY is not set, email sending is disabled. ' +
          'Set RESEND_API_KEY and (optionally) RESEND_FROM to enable.',
      );
      this.client = null;
      return;
    }
    this.client = new Resend(key);
    this.logger.log(`Resend email transport ready (from="${this.from}")`);
  }

  async send(input: TransactionalEmailInput): Promise<{ messageId: string }> {
    if (!this.client) {
      this.logger.warn(
        `Skipped email "${input.subject}"Resend not configured.`,
      );
      return { messageId: '' };
    }
    const { data, error } = await this.client.emails.send({
      from: input.from ?? this.from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      cc: input.cc,
      bcc: input.bcc,
      headers: input.headers,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.bytes,
        contentType: a.contentType,
      })),
    });
    if (error) {
      // Resend returns structured errors instead of throwing. Surface them
      // as exceptions so EmailService's fire-and-forget catch logs them.
      throw new Error(`${error.name}: ${error.message}`);
    }
    return { messageId: data?.id ?? '' };
  }
}
