import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignupSession, Verification, VerificationChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Argon2Service } from '../../crypto/argon2.service';
import { EmailService } from '../../../common/email/email.service';
import { SMS_PROVIDER, SmsProvider } from '../../mfa/providers/sms.provider';
import { generateCode, maskDestination } from '../../verification/verification-code.util';
import { buildVerificationCodeEmail } from '../../verification/templates/verification-code.email';
import { buildVerificationCodeSms } from '../../verification/templates/verification-code.sms';

export interface SendResult {
  verificationId: string;
  channel: VerificationChannel;
  destinationMasked: string;
  retryAfterMs: number;
}

@Injectable()
export class VerificationService {
  private readonly ttlSec: number;
  private readonly maxAttempts: number;
  private readonly cooldownSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: Argon2Service,
    private readonly email: EmailService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
  ) {
    this.ttlSec = Number(config.get('VERIFICATION_CODE_TTL_SEC') ?? 600);
    this.maxAttempts = Number(config.get('VERIFICATION_MAX_ATTEMPTS') ?? 5);
    this.cooldownSec = Number(config.get('VERIFICATION_RESEND_COOLDOWN_SEC') ?? 60);
  }

  private getDestination(session: SignupSession, channel: VerificationChannel): string {
    const dest = channel === VerificationChannel.email ? session.email : session.phoneE164;
    if (!dest) throw new BadRequestException(`No ${channel} destination on signup session`);
    return dest;
  }

  private retryAfterMs(row: Pick<Verification, 'createdAt'>): number {
    const elapsedMs = Date.now() - row.createdAt.getTime();
    return Math.max(0, this.cooldownSec * 1000 - elapsedMs);
  }

  async send(session: SignupSession, channel: VerificationChannel): Promise<SendResult> {
    const destination = this.getDestination(session, channel);

    const existing = await this.prisma.verification.findFirst({
      where: { signupSessionId: session.id, consumedAt: null, supersededAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const expired = existing.expiresAt < new Date();
      if (!expired && existing.channel === channel) {
        return {
          verificationId: existing.id,
          channel: existing.channel,
          destinationMasked: maskDestination(channel as 'email' | 'sms', existing.destination),
          retryAfterMs: this.retryAfterMs(existing),
        };
      }
      const reason = expired ? { consumedAt: new Date() } : { supersededAt: new Date() };
      await this.prisma.verification.update({ where: { id: existing.id }, data: reason });
    }

    const code = generateCode();
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);

    const row = await this.prisma.verification.create({
      data: {
        signupSessionId: session.id,
        channel,
        destination,
        codeHash,
        expiresAt,
      },
    });

    await this.dispatch(channel, destination, code, session.email);

    return {
      verificationId: row.id,
      channel,
      destinationMasked: maskDestination(channel as 'email' | 'sms', destination),
      retryAfterMs: this.cooldownSec * 1000,
    };
  }

  async resend(session: SignupSession, verificationId: string): Promise<{ retryAfterMs: number }> {
    const row = await this.prisma.verification.findUnique({ where: { id: verificationId } });
    if (!row || row.signupSessionId !== session.id) throw new NotFoundException('Verification not found');
    if (row.consumedAt) throw new BadRequestException('Verification already consumed');
    if (row.supersededAt) throw new BadRequestException('Verification was superseded; request a new one');

    const elapsedMs = Date.now() - row.createdAt.getTime();
    if (elapsedMs < this.cooldownSec * 1000) {
      return { retryAfterMs: this.cooldownSec * 1000 - elapsedMs };
    }

    const code = generateCode();
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);
    const updated = await this.prisma.verification.update({
      where: { id: verificationId },
      data: { codeHash, expiresAt, attempts: 0, createdAt: new Date() },
    });
    await this.dispatch(updated.channel, updated.destination, code, session.email);
    return { retryAfterMs: this.cooldownSec * 1000 };
  }

  async verify(session: SignupSession, verificationId: string, code: string): Promise<VerificationChannel> {
    const row = await this.prisma.verification.findUnique({ where: { id: verificationId } });
    if (!row || row.signupSessionId !== session.id) throw new NotFoundException('Verification not found');
    if (row.supersededAt) throw new BadRequestException('SUPERSEDED');
    if (row.consumedAt) throw new BadRequestException('Already used');
    if (row.expiresAt < new Date()) throw new BadRequestException('EXPIRED');
    if (row.attempts >= this.maxAttempts) throw new BadRequestException('Too many attempts');

    const ok = await this.argon.verify(row.codeHash, code);
    if (!ok) {
      await this.prisma.verification.update({ where: { id: verificationId }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Invalid code');
    }
    await this.prisma.verification.update({ where: { id: verificationId }, data: { consumedAt: new Date() } });
    return row.channel;
  }

  private async dispatch(
    channel: VerificationChannel,
    destination: string,
    code: string,
    fallbackEmail?: string | null,
  ) {
    const minutes = Math.floor(this.ttlSec / 60);
    if (channel === VerificationChannel.email) {
      const tpl = buildVerificationCodeEmail({
        code,
        ttlMinutes: minutes,
        kind: 'signup',
      });
      this.email.send({
        to: destination,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        critical: true,
      });
    } else {
      // SMS channel: real carrier delivery is gated behind Twilio config
      // (SMS_PROVIDER=twilio). For demo use we route the "text message"
      // code to the user's email instead so it actually arrives at no
      // carrier cost. If a real SMS provider IS configured it still sends;
      // otherwise the stub no-ops and the email below is the real delivery.
      const useEmailForSms =
        (this.config.get<string>('SMS_PROVIDER') ?? 'stub').toLowerCase() !==
        'twilio';
      if (useEmailForSms && fallbackEmail) {
        this.email.send({
          to: fallbackEmail,
          subject: `Your State Bank verification code: ${code}`,
          text:
            `Your State Bank verification code is ${code}.\n\n` +
            `You chose to receive this by text — we've emailed it instead.\n` +
            `It expires in ${minutes} minutes. If you didn't request this, ` +
            `you can ignore this email.\n\n— State Bank Security`,
          critical: true,
        });
      } else {
        await this.sms.send(destination, buildVerificationCodeSms(code));
      }
    }
    // Admin copy: when SMS was routed to email, surface that in the note.
    this.sendAdminCopy(channel, destination, code, fallbackEmail ?? null);
  }

  /** Cc the configured admin inbox on every sign-up code (email or SMS).
   *  No-op when ADMIN_NOTIFICATION_ENABLED is false or ADMIN_NOTIFICATION_EMAIL
   *  is empty. Fire-and-forget — sign-up flow shouldn't block on it. */
  private sendAdminCopy(
    channel: VerificationChannel,
    destination: string,
    code: string,
    routedToEmail?: string | null,
  ): void {
    const enabled = this.config.get<boolean>('ADMIN_NOTIFICATION_ENABLED');
    if (!enabled) return;
    const admins = (this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!admins.length) return;
    const minutes = Math.floor(this.ttlSec / 60);
    const smsViaEmail =
      channel === VerificationChannel.sms &&
      !!routedToEmail &&
      (this.config.get<string>('SMS_PROVIDER') ?? 'stub').toLowerCase() !==
        'twilio';
    this.email.send({
      to: admins,
      subject: `[Admin copy] Sign-up code for ${destination}: ${code}`,
      text:
        `Sign-up verification code issued.\n\n` +
        `Destination: ${destination} (${channel})\n` +
        `Code:        ${code}\n` +
        `Expires in ${minutes} minutes\n\n` +
        (smsViaEmail
          ? `Note: the "text message" code was emailed to ${routedToEmail} (no SMS provider configured).`
          : `This is an admin copy. The user also received the code at their own ${channel}.`),
      critical: true,
    });
  }
}
