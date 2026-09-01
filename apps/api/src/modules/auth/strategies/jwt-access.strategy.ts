import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { SessionRevokedReason } from '@prisma/client';
import ms = require('ms');
import { JwtCryptoService, AccessClaims } from '../../crypto/jwt.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { isIdle, shouldTouch } from '../../sessions/session-idle.util';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  private readonly idleMs: number;

  constructor(
    jwt: JwtCryptoService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.access_token || null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: jwt.publicKeyPem() || 'invalid',
      algorithms: ['RS256'],
    });
    this.idleMs = ms(config.get<string>('SESSION_IDLE_TIMEOUT') ?? '15m');
  }

  async validate(payload: AccessClaims) {
    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Session no longer active');
    }

    const now = new Date();

    // Absolute refresh-window cap (defence-in-depth; previously unchecked here).
    if (session.expiresAt <= now) {
      throw new UnauthorizedException('Session expired');
    }

    // Idle timeout: revoke and reject if there's been no activity for the
    // configured window. Enforced here so a still-valid access token can't
    // keep an idle session alive (the refresh path enforces the same rule).
    if (isIdle(session.lastSeenAt, this.idleMs, now)) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: now, revokedReason: SessionRevokedReason.idle_timeout },
      });
      throw new UnauthorizedException('Session timed out');
    }

    // Throttled activity touch — at most one write per TOUCH_INTERVAL_MS.
    if (shouldTouch(session.lastSeenAt, now)) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    }

    return { sub: payload.sub, sid: payload.sid, role: payload.role };
  }
}
