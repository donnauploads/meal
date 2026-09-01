import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * Read API for the admin audit trail. Writes happen via `AdminAuditService`
 * from the various admin flows; this exposes the log to the dashboard
 * (`/admin/audit`). Admin + superadmin only.
 */
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Query('actorUserId') actorUserId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.audit.list({
      actorUserId: actorUserId || undefined,
      targetType: targetType || undefined,
      targetId: targetId || undefined,
      limit: limit ? Number(limit) : 200,
    });

    // Join actor display info in one query.
    const actorIds = [...new Set(rows.map((r) => r.actorUserId))];
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u] as const));

    return rows.map((r) => {
      const u = byId.get(r.actorUserId);
      return {
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata ?? {},
        createdAt: r.createdAt.toISOString(),
        actor: u
          ? {
              id: u.id,
              name:
                [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
                u.email,
              email: u.email,
            }
          : { id: r.actorUserId, name: 'Unknown', email: '' },
      };
    });
  }
}
