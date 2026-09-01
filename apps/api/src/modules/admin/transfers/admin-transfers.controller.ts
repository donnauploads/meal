import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { AdminTransfersService } from './admin-transfers.service';
import { TransferReviewDecisionDto } from '../dto/admin.dto';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/transfers')
export class AdminTransfersController {
  constructor(private readonly svc: AdminTransfersService) {}

  @Get('review-queue')
  list(@Query('limit') limit?: string) {
    return this.svc.listReviewQueue(limit ? Number(limit) : undefined);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferReviewDecisionDto,
  ) {
    return this.svc.decide(user.sub, id, dto);
  }
}
