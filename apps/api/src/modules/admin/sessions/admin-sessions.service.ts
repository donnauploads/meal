import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRevokedReason } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SessionsService } from '../../sessions/sessions.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';

/**
 * Admin-side read + revoke for any user's currently-active session.
 *
 * "Active" = no `revokedAt` AND `expiresAt > now`. The user-scoped
 * SessionsService.revokeOne refuses to act on another user's row;
 * here we wrap a direct admin revoke + emit the realtime push so the
 * affected client is force-logged out within ~1s.
 */
@Injectable()
export class AdminSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly audit: AdminAuditService,
  ) {}

  async listActive() {
    const rows = await this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            novaTag: true,
            role: true,
          },
        },
        device: {
          select: {
            id: true,
            name: true,
            os: true,
            browser: true,
            ipLastSeen: true,
            locationLastSeen: true,
            lastSeenAt: true,
            trusted: true,
          },
        },
      },
      take: 200,
    });

    return rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      user: {
        id: s.user.id,
        email: s.user.email,
        name:
          [s.user.firstName, s.user.lastName].filter(Boolean).join(' ').trim() ||
          s.user.novaTag ||
          s.user.email,
        role: s.user.role,
      },
      device: {
        id: s.device.id,
        name: s.device.name,
        os: s.device.os,
        browser: s.device.browser,
        ip: s.device.ipLastSeen,
        location: s.device.locationLastSeen as Record<string, unknown> | null,
        lastSeenAt: s.device.lastSeenAt.toISOString(),
        trusted: s.device.trusted,
      },
    }));
  }

  /**
   * Admin revoke. Bypasses the per-user ownership check inside
   * SessionsService.revokeOne by doing the update + emit ourselves.
   */
  async revoke(actorUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.revokedAt) return { id: sessionId, alreadyRevoked: true };

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: SessionRevokedReason.admin_revoke,
      },
    });
    // Re-use the service's emit path so the realtime gateway pushes
    // `session.revoked` to the affected device — same contract as a
    // user-initiated revoke.
    (this.sessions as unknown as {
      emitRevoked: (p: {
        userId: string;
        sessionId: string;
        reason: SessionRevokedReason;
        at: Date;
      }) => void;
    }).emitRevoked({
      userId: session.userId,
      sessionId: session.id,
      reason: SessionRevokedReason.admin_revoke,
      at: new Date(),
    });

    await this.audit.write({
      actorUserId,
      action: 'session.admin_revoke',
      targetType: 'session',
      targetId: sessionId,
      metadata: { userId: session.userId, deviceId: session.deviceId },
    });

    return { id: sessionId, alreadyRevoked: false };
  }
}
