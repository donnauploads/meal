import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { AdminSessionsService } from './admin-sessions.service';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/sessions')
export class AdminSessionsController {
  constructor(private readonly svc: AdminSessionsService) {}

  @Get()
  list() {
    return this.svc.listActive();
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.revoke(user.sub, id);
  }
}
