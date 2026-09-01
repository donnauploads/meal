import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionRevokedReason } from '@prisma/client';
import { createHmac, randomInt } from 'crypto';
import { Public } from '../decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../../../common/email/email.service';
import { Argon2Service } from '../../crypto/argon2.service';
import { JwtCryptoService } from '../../crypto/jwt.service';
import { SessionsService } from '../../sessions/sessions.service';
import {
  RecoverRequestDto,
  RecoverResetDto,
  RecoverVerifyDto,
} from './dto/recovery.dto';
import { buildVerificationCodeEmail } from '../../verification/templates/verification-code.email';

/** Minimal subset of the generated `PrismaClient.passwordResetChallenge`
 *  delegate we actually call. Lets the controller compile cleanly even
 *  when the engine DLL is locked (Windows dev hot-reload) and a fresh
 *  `prisma generate` hasn't run. Same cast-through trick used in
 *  admin-users.service.ts and transfers.service.ts elsewhere. */
type PrismaPasswordResetChallenge = {
  create: (args: { data: Record<string, unknown> }) => Promise<{
    id: string;
    userId: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    consumedAt: Date | null;
    supersededAt: Date | null;
  }>;
  findFirst: (args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }) => Promise<{
    id: string;
    userId: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    consumedAt: Date | null;
    supersededAt: Date | null;
  } | null>;
  update: (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
};

/**
 * Password recovery via 6-digit OTP. Three-step flow:
 *   1. POST /auth/recover/password          → issue + email a code
 *   2. POST /auth/recover/password/verify   → consume the code, return a JWT
 *   3. POST /auth/recover/password/reset    → use that JWT to set a new password
 *
 * The endpoints intentionally never confirm whether an email maps to an
 * account at step 1 — they always return 200. Wrong-code attempts are
 * rate-limited per-challenge so brute force has to start over after
 * each lockout.
 */
@Public()
@Controller('auth/recover')
export class RecoveryController {
  private readonly logger = new Logger(RecoveryController.name);
  private readonly ttlSec: number;
  private readonly maxAttempts: number;
  private readonly emailHmacSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtCryptoService,
    private readonly argon: Argon2Service,
    private readonly email: EmailService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {
    this.ttlSec = Number(
      config.get('PASSWORD_RESET_TTL_SECONDS') ?? 600,
    );
    this.maxAttempts = Number(
      config.get('PASSWORD_RESET_MAX_ATTEMPTS') ?? 5,
    );
    // Defensive HMAC of the email address — we don't store the
    // plaintext on the challenge row, just a stable hash so a leak of
    // this table doesn't expose user emails.
    this.emailHmacSecret =
      config.get<string>('PASSWORD_RESET_EMAIL_HMAC_SECRET') ??
      config.get<string>('JWT_SECRET') ??
      'dev-fallback-do-not-ship';
  }

  /** Step 1 — issue a code. Always responds 200. */
  @Post('password')
  @HttpCode(200)
  async request(@Body() dto: RecoverRequestDto): Promise<{ ok: true }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // No account → silently no-op so we don't leak existence.
      this.logger.debug(`recover/password: no user for ${email}`);
      return { ok: true };
    }

    const emailHash = this.hashEmail(email);

    // Supersede any open challenge for this user so a stale code can't
    // race the new one. consumedAt remains untouched (consumed rows
    // are already terminal).
    await this.supersedeOpenChallenges(user.id, emailHash);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await this.argon.hash(code);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);

    await (this.prisma as unknown as { passwordResetChallenge: PrismaPasswordResetChallenge }).passwordResetChallenge.create({
      data: {
        userId: user.id,
        emailHash,
        codeHash,
        expiresAt,
      },
    });

    const minutes = Math.max(1, Math.floor(this.ttlSec / 60));
    const tpl = buildVerificationCodeEmail({
      code,
      ttlMinutes: minutes,
      kind: 'recovery',
    });
    await this.email.send({
      to: user.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      // NOT critical: the admin email-notifications kill switch suppresses
      // self-service password-reset codes too.
    });

    return { ok: true };
  }

  /** Step 2 — verify a code, return a short-lived JWT for step 3. */
  @Post('password/verify')
  @HttpCode(200)
  async verify(
    @Body() dto: RecoverVerifyDto,
  ): Promise<{ token: string }> {
    const email = dto.email.trim().toLowerCase();
    const emailHash = this.hashEmail(email);
    const challenge = await (this.prisma as unknown as { passwordResetChallenge: PrismaPasswordResetChallenge }).passwordResetChallenge.findFirst({
      where: {
        emailHash,
        consumedAt: null,
        supersededAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    // Never leak which of `unknown email`, `no open challenge`,
    // `expired`, `too many attempts`, `wrong code` happened — all
    // produce the same 401 with a generic message.
    if (!challenge) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (challenge.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (challenge.attempts >= this.maxAttempts) {
      // Lock this challenge so further attempts on the same row also
      // fail until the user requests a new code.
      throw new UnauthorizedException('Invalid or expired code');
    }

    const ok = await this.argon.verify(challenge.codeHash, dto.code);
    if (!ok) {
      await (this.prisma as unknown as { passwordResetChallenge: PrismaPasswordResetChallenge }).passwordResetChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid or expired code');
    }

    await (this.prisma as unknown as { passwordResetChallenge: PrismaPasswordResetChallenge }).passwordResetChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const token = this.jwt.signRecovery(challenge.userId);
    return { token };
  }

  /** Step 3 — exchange the JWT for an actual password change. */
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() dto: RecoverResetDto): Promise<void> {
    let sub: string;
    try {
      sub = this.jwt.verifyRecovery(dto.token).sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) throw new UnauthorizedException('Invalid token');
    if (dto.newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const newHash = await this.argon.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });
    await this.sessions.revokeAllOther(
      user.id,
      '00000000-0000-0000-0000-000000000000',
      SessionRevokedReason.password_changed,
    );
  }

  private hashEmail(email: string): string {
    return createHmac('sha256', this.emailHmacSecret)
      .update(email)
      .digest('hex');
  }

  private async supersedeOpenChallenges(
    userId: string,
    emailHash: string,
  ): Promise<void> {
    await (this.prisma as unknown as { passwordResetChallenge: PrismaPasswordResetChallenge }).passwordResetChallenge.updateMany({
      where: {
        userId,
        emailHash,
        consumedAt: null,
        supersededAt: null,
      },
      data: { supersededAt: new Date() },
    });
  }
}
