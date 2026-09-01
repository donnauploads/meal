import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionRevokedReason, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Argon2Service } from '../crypto/argon2.service';
import { JwtCryptoService } from '../crypto/jwt.service';
import { DevicesService } from '../devices/devices.service';
import { MfaService } from '../mfa/mfa.service';
import { SessionsService } from '../sessions/sessions.service';
import { parseUaSummary } from '../devices/fingerprint.util';

export interface LoginRequestContext {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  timezone?: string;
  canvasHash?: string;
}

export type LoginOutcome =
  | { stage: 'session'; accessToken: string; refreshToken: string; sessionId: string }
  | {
      stage: 'mfa';
      mfaToken: string;
      channel: 'sms' | 'email';
      phoneHint: string | null;
      emailHint: string | null;
    };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: Argon2Service,
    private readonly jwt: JwtCryptoService,
    private readonly devices: DevicesService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string, ctx: LoginRequestContext): Promise<LoginOutcome> {
    // Email is matched case-insensitively — addresses are stored as the user
    // typed them at signup, so "User@x.com" must still log in as "user@x.com".
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.active) throw new ForbiddenException('Account not active');

    const ok = await this.argon.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const fingerprint = this.devices.fingerprint({
      userAgent: ctx.userAgent,
      acceptLanguage: ctx.acceptLanguage,
      timezone: ctx.timezone ?? '',
      canvasHash: ctx.canvasHash,
    });
    const known = await this.devices.findKnown(user.id, fingerprint);

    if (known && known.trusted && !known.revokedAt) {
      const device = await this.devices.upsertOnLogin({
        userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent,
        acceptLanguage: ctx.acceptLanguage, timezone: ctx.timezone ?? '', canvasHash: ctx.canvasHash,
      });
      const issued = await this.sessions.issueSession({
        userId: user.id, deviceId: device.id, role: user.role, ip: ctx.ip,
      });
      return {
        stage: 'session',
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        sessionId: issued.session.id,
      };
    }

    const summary = parseUaSummary(ctx.userAgent);
    const challenge = await this.mfa.createEmailChallenge(user.id, user.email, {
      fingerprint,
      name: summary.name,
      os: summary.os,
      browser: summary.browser,
      ip: ctx.ip,
    });
    const mfaToken = this.jwt.signMfa({ sub: user.id, cid: challenge.id });
    return {
      stage: 'mfa',
      mfaToken,
      channel: 'email',
      phoneHint: null,
      emailHint: maskEmail(user.email),
    };
  }

  async mfaVerify(mfaToken: string, code: string, ctx: LoginRequestContext): Promise<LoginOutcome & { stage: 'session' }> {
    let claims: ReturnType<JwtCryptoService['verifyMfa']>;
    try {
      claims = this.jwt.verifyMfa(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
    const challenge = await this.mfa.verify(claims.cid, code);
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    const device = await this.devices.upsertOnLogin({
      userId: user.id, ip: ctx.ip || challenge.pendingIp,
      userAgent: ctx.userAgent, acceptLanguage: ctx.acceptLanguage,
      timezone: ctx.timezone ?? '', canvasHash: ctx.canvasHash,
    });
    await this.devices.markTrusted(device.id);

    const issued = await this.sessions.issueSession({
      userId: user.id, deviceId: device.id, role: user.role, ip: ctx.ip,
    });
    return {
      stage: 'session',
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.session.id,
    };
  }

  async mfaResend(mfaToken: string): Promise<{ mfaToken: string }> {
    let claims: ReturnType<JwtCryptoService['verifyMfa']>;
    try {
      claims = this.jwt.verifyMfa(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) throw new UnauthorizedException('User no longer exists');
    await this.mfa.resend(claims.cid, { email: user.email });
    // Re-issue the capability token so the verification window refreshes on
    // every resend. Otherwise it keeps counting down to the original expiry,
    // and a later resend/verify would 401 even though we just sent a new code.
    return { mfaToken: this.jwt.signMfa({ sub: claims.sub, cid: claims.cid }) };
  }

  async refresh(presented: string) {
    if (!presented) throw new UnauthorizedException('No refresh token');
    return this.sessions.rotateRefresh(presented);
  }

  async logout(sessionId: string, actingUserId: string): Promise<void> {
    await this.sessions.revokeOne(sessionId, actingUserId, SessionRevokedReason.user_signout);
  }

  async changePassword(user: User, currentPassword: string, newPassword: string, currentSessionId: string) {
    const ok = await this.argon.verify(user.passwordHash, currentPassword);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (currentPassword === newPassword) throw new BadRequestException('New password must differ from current');

    const newHash = await this.argon.hash(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    await this.sessions.revokeAllOther(user.id, currentSessionId, SessionRevokedReason.password_changed);
  }

  /**
   * First-login password set for admin-provisioned accounts. No current
   * password is required — the authenticated session is the proof of
   * identity — but the account MUST currently be flagged
   * securitySetupRequired, so this can't be used as a generic
   * password-change bypass. The flag itself is cleared later, when the
   * user sets their transaction PIN (the final gate step).
   */
  async setFirstLoginPassword(user: User, newPassword: string, currentSessionId: string) {
    const rows = await this.prisma.$queryRaw<{ securitySetupRequired: boolean }[]>`
      SELECT "securitySetupRequired" FROM "User" WHERE "id" = ${user.id}::uuid LIMIT 1
    `;
    if (!rows[0]?.securitySetupRequired) {
      throw new BadRequestException('Account is not awaiting first-login setup');
    }
    const sameAsTemp = await this.argon.verify(user.passwordHash, newPassword);
    if (sameAsTemp) {
      throw new BadRequestException('Choose a password different from the temporary one');
    }
    const newHash = await this.argon.hash(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    await this.sessions.revokeAllOther(user.id, currentSessionId, SessionRevokedReason.password_changed);
  }
}

function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  return e164.replace(/.(?=.{4})/g, '•');
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}
