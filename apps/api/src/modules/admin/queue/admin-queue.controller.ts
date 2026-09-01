import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminTransfersService } from '../transfers/admin-transfers.service';

/**
 * Live counts for items awaiting an admin's attention. Sidebar badges in
 * the admin UI poll this on mount and subsequently rely on the
 * `admin.queue.changed` WebSocket event (broadcast from the relevant
 * services) to update without an explicit refetch.
 */
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/queue-counts')
export class AdminQueueCountsController {
  constructor(private readonly svc: AdminTransfersService) {}

  @Get()
  counts() {
    return this.svc.queueCounts();
  }
}
