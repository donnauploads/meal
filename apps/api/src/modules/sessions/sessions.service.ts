import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Session, SessionRevokedReason } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import ms = require('ms');
import { PrismaService } from '../../prisma/prisma.service';
import { JwtCryptoService } from '../crypto/jwt.service';
import { NEST_EVENT, NestSessionCreatedPayload, NestSessionRevokedPayload } from '../realtime/events';
import { isIdle } from './session-idle.util';

export interface IssueSessionInput {
  userId: string;
  deviceId: string;
  role: string;
  ip: string;
}

export interface IssueSessionResult {
  session: Session;
  accessToken: string;
  refreshToken: string;
  revokedIds: string[];
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly refreshTtlMs: number;
  private readonly idleMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtCryptoService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.refreshTtlMs = ms(config.get<string>('JWT_REFRESH_TTL') ?? '30d');
    this.idleMs = ms(config.get<string>('SESSION_IDLE_TIMEOUT') ?? '15m');
  }

  async issueSession(input: IssueSessionInput): Promise<IssueSessionResult> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    const access = this.jwt.signAccess({ sub: input.userId, sid: sessionId, role: input.role });
    const refresh = this.jwt.signRefresh({ sub: input.userId, sid: sessionId, fam: familyId });
    const refreshTokenHash = sha256(refresh.token);

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          id: sessionId,
          userId: input.userId,
          deviceId: input.deviceId,
          accessTokenJti: access.jti,
          refreshTokenHash,
          refreshTokenFamilyId: familyId,
          expiresAt,
          lastSeenAt: new Date(),
        },
      });
      const others = await tx.session.findMany({
        where: { userId: input.userId, revokedAt: null, id: { not: sessionId } },
        select: { id: true },
      });
      if (others.length) {
        await tx.session.updateMany({
          where: { userId: input.userId, revokedAt: null, id: { not: sessionId } },
          data: { revokedAt: new Date(), revokedReason: SessionRevokedReason.newer_login },
        });
      }
      return { session, revokedIds: others.map((o) => o.id) };
    });

    for (const sid of result.revokedIds) {
      this.emitRevoked({ userId: input.userId, sessionId: sid, reason: 'newer_login', at: new Date() });
    }
    this.events.emit(NEST_EVENT.SessionCreated, {
      userId: input.userId,
      sessionId: result.session.id,
      deviceId: input.deviceId,
      ip: input.ip,
      at: new Date(),
    } as NestSessionCreatedPayload);

    return {
      session: result.session,
      accessToken: access.token,
      refreshToken: refresh.token,
      revokedIds: result.revokedIds,
    };
  }

  async rotateRefresh(presented: string): Promise<IssueSessionResult> {
    let claims: ReturnType<JwtCryptoService['verifyRefresh']>;
    try {
      claims = this.jwt.verifyRefresh(presented);
    } catch {
      throw new ForbiddenException('Invalid refresh token');
    }
    const presentedHash = sha256(presented);

    const replay = await this.prisma.refreshTokenAudit.findUnique({ where: { tokenHash: presentedHash } });
    if (replay) {
      await this.revokeFamily(replay.familyId, SessionRevokedReason.reuse_detected);
      throw new ForbiddenException('Refresh reuse detected; session revoked');
    }

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
      include: { user: { select: { role: true } } },
    });
    if (!session || session.revokedAt) {
      if (claims.fam) await this.revokeFamily(claims.fam, SessionRevokedReason.reuse_detected);
      throw new ForbiddenException('Refresh token no longer valid');
    }

    // Idle timeout: an expired access token must not silently refresh an
    // idle session back to life. Same rule the access strategy enforces.
    if (isIdle(session.lastSeenAt, this.idleMs)) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: SessionRevokedReason.idle_timeout },
      });
      throw new ForbiddenException('Session timed out');
    }

    const access = this.jwt.signAccess({ sub: session.userId, sid: session.id, role: session.user.role });
    const refresh = this.jwt.signRefresh({ sub: session.userId, sid: session.id, fam: session.refreshTokenFamilyId });
    const newHash = sha256(refresh.token);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.refreshTokenAudit.create({
        data: {
          familyId: session.refreshTokenFamilyId,
          tokenHash: presentedHash,
          sessionId: session.id,
        },
      });
      return tx.session.update({
        where: { id: session.id },
        data: { accessTokenJti: access.jti, refreshTokenHash: newHash },
      });
    });

    return {
      session: updated,
      accessToken: access.token,
      refreshToken: refresh.token,
      revokedIds: [],
    };
  }

  async revokeAllForUser(userId: string, reason: SessionRevokedReason): Promise<string[]> {
    const all = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    if (!all.length) return [];
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    for (const s of all) {
      this.emitRevoked({ userId, sessionId: s.id, reason, at: new Date() });
    }
    return all.map((s) => s.id);
  }

  async revokeFamily(familyId: string, reason: SessionRevokedReason): Promise<void> {
    const affected = await this.prisma.session.findMany({
      where: { refreshTokenFamilyId: familyId, revokedAt: null },
      select: { id: true, userId: true },
    });
    if (!affected.length) return;
    await this.prisma.session.updateMany({
      where: { refreshTokenFamilyId: familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    for (const s of affected) {
      this.emitRevoked({ userId: s.userId, sessionId: s.id, reason, at: new Date() });
    }
  }

  async revokeOne(sessionId: string, actingUserId: string, reason: SessionRevokedReason): Promise<void> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    if (s.userId !== actingUserId) throw new ForbiddenException('Not your session');
    if (s.revokedAt) return;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    this.emitRevoked({ userId: s.userId, sessionId: s.id, reason, at: new Date() });
  }

  /**
   * Admin "reset login history": force-log-out every active session (same
   * realtime push as a revoke), then HARD-DELETE all of the user's sessions,
   * their refresh-token audit trail, and device records. Unlike revoke (which
   * keeps the rows for the timeline), this wipes the history entirely — the
   * user starts clean with a brand-new device + session on next sign-in.
   */
  async purgeForUser(userId: string): Promise<{
    loggedOut: number;
    sessionsDeleted: number;
    devicesDeleted: number;
  }> {
    // 1. Boot every live session off their devices first.
    const active = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    for (const s of active) {
      this.emitRevoked({
        userId,
        sessionId: s.id,
        reason: SessionRevokedReason.admin_revoke,
        at: new Date(),
      });
    }

    // 2. Wipe sessions + their refresh-token audit rows + device records.
    //    Order matters: sessions reference devices (FK), so delete sessions
    //    before devices.
    const families = await this.prisma.session.findMany({
      where: { userId },
      select: { refreshTokenFamilyId: true },
    });
    const familyIds = [...new Set(families.map((f) => f.refreshTokenFamilyId))];

    const [, sessionsDel, devicesDel] = await this.prisma.$transaction([
      this.prisma.refreshTokenAudit.deleteMany({
        where: { familyId: { in: familyIds } },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.device.deleteMany({ where: { userId } }),
    ]);

    return {
      loggedOut: active.length,
      sessionsDeleted: sessionsDel.count,
      devicesDeleted: devicesDel.count,
    };
  }

  async revokeAllOther(userId: string, currentSessionId: string, reason: SessionRevokedReason): Promise<string[]> {
    const others = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      select: { id: true },
    });
    if (!others.length) return [];
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    for (const o of others) {
      this.emitRevoked({ userId, sessionId: o.id, reason, at: new Date() });
    }
    return others.map((o) => o.id);
  }

  async listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      include: { device: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  isActive(session: Pick<Session, 'revokedAt' | 'expiresAt'>): boolean {
    return !session.revokedAt && session.expiresAt > new Date();
  }

  hashRefresh(token: string): string {
    return sha256(token);
  }

  private emitRevoked(payload: NestSessionRevokedPayload) {
    this.events.emit(NEST_EVENT.SessionRevoked, payload);
  }
}
