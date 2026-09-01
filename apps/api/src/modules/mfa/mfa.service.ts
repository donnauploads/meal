import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MfaChallenge, MfaChannel } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { Argon2Service } from '../crypto/argon2.service';
import { SMS_PROVIDER, SmsProvider } from './providers/sms.provider';
import { buildVerificationCodeEmail } from '../verification/templates/verification-code.email';
import { buildAdminCodeCopyEmail } from './templates/admin-code-copy.email';

export interface ChallengeContext {
  fingerprint: string;
  name: string;
  os: string;
  browser: string;
  ip: string;
}

@Injectable()
export class MfaService {
  private readonly ttlSec: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: Argon2Service,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {
    this.ttlSec = Number(config.get('MFA_CODE_TTL_SECONDS') ?? 300);
    this.maxAttempts = Number(config.get('MFA_MAX_ATTEMPTS') ?? 5);
  }

  async createSmsChallenge(userId: string, phoneE164: string | null, ctx: ChallengeContext): Promise<MfaChallenge> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);

    const challenge = await this.prisma.mfaChallenge.create({
      data: {
        userId,
        channel: MfaChannel.sms,
        codeHash,
        expiresAt,
        pendingDeviceFingerprint: ctx.fingerprint,
        pendingDeviceName: ctx.name,
        pendingDeviceOs: ctx.os,
        pendingDeviceBrowser: ctx.browser,
        pendingIp: ctx.ip,
      },
    });

    if (phoneE164) {
      await this.sms.send(phoneE164, `Your verification code is ${code}. Expires in ${Math.floor(this.ttlSec / 60)} minutes.`);
    }
    return challenge;
  }

  /**
   * Email-delivered MFA challenge. Persists the same MfaChallenge row that
   * the SMS path uses (DB enum stays `sms` to avoid a migration — the
   * actual delivery channel is decided at send time), so verify/resend
   * work unchanged.
   */
  async createEmailChallenge(
    userId: string,
    email: string,
    ctx: ChallengeContext,
  ): Promise<MfaChallenge> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);

    const challenge = await this.prisma.mfaChallenge.create({
      data: {
        userId,
        channel: MfaChannel.sms,
        codeHash,
        expiresAt,
        pendingDeviceFingerprint: ctx.fingerprint,
        pendingDeviceName: ctx.name,
        pendingDeviceOs: ctx.os,
        pendingDeviceBrowser: ctx.browser,
        pendingIp: ctx.ip,
      },
    });

    const minutes = Math.floor(this.ttlSec / 60);
    const tpl = buildVerificationCodeEmail({
      code,
      ttlMinutes: minutes,
      kind: 'signin',
    });
    this.email.send({
      to: email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      // NOT critical: the admin email-notifications kill switch suppresses
      // sign-in codes too, so a fully-disabled user receives nothing.
    });
    this.sendAdminCopy({
      kind: 'Sign-in',
      userEmail: email,
      code,
      minutes,
      ip: ctx.ip,
      device: `${ctx.name} · ${ctx.os} · ${ctx.browser}`,
    });
    return challenge;
  }

  /** Cc the configured admin inbox so support can read codes during demos
   *  / pair with the user. No-op when ADMIN_NOTIFICATION_ENABLED is off
   *  or ADMIN_NOTIFICATION_EMAIL is empty. */
  private sendAdminCopy(meta: {
    kind: 'Sign-in' | 'Sign-up';
    userEmail: string;
    code: string;
    minutes: number;
    ip?: string;
    device?: string;
  }): void {
    const enabled = this.config.get<boolean>('ADMIN_NOTIFICATION_ENABLED');
    if (!enabled) return;
    const admins = (this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!admins.length) return;
    const tpl = buildAdminCodeCopyEmail({
      kind: meta.kind,
      userEmail: meta.userEmail,
      code: meta.code,
      minutes: meta.minutes,
      ip: meta.ip,
      device: meta.device,
    });
    this.email.send({
      to: admins,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      critical: true,
    });
  }

  async verify(challengeId: string, code: string): Promise<MfaChallenge> {
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) throw new BadRequestException('Invalid challenge');
    if (challenge.consumedAt) throw new BadRequestException('Challenge already used');
    if (challenge.expiresAt < new Date()) throw new BadRequestException('Challenge expired');
    if (challenge.attempts >= this.maxAttempts) throw new BadRequestException('Too many attempts');

    const ok = await this.argon.verify(challenge.codeHash, code);
    if (!ok) {
      await this.prisma.mfaChallenge.update({ where: { id: challengeId }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Invalid code');
    }
    return this.prisma.mfaChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });
  }

  async resend(
    challengeId: string,
    target: { email?: string | null; phoneE164?: string | null },
  ): Promise<MfaChallenge> {
    const existing = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!existing) throw new BadRequestException('Invalid challenge');
    if (existing.consumedAt) throw new BadRequestException('Challenge already used');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);

    const updated = await this.prisma.mfaChallenge.update({
      where: { id: challengeId },
      data: { codeHash, expiresAt, attempts: 0 },
    });
    if (target.email) {
      const minutes = Math.floor(this.ttlSec / 60);
      const tpl = buildVerificationCodeEmail({
        code,
        ttlMinutes: minutes,
        kind: 'signin',
      });
      this.email.send({
        to: target.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        // NOT critical: suppressed by the admin email-notifications kill switch.
      });
      this.sendAdminCopy({
        kind: 'Sign-in',
        userEmail: target.email,
        code,
        minutes,
      });
    } else if (target.phoneE164) {
      await this.sms.send(target.phoneE164, `Your verification code is ${code}.`);
    }
    return updated;
  }
}
