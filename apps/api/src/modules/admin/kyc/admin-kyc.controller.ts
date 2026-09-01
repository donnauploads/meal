import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { AdminKycService } from './admin-kyc.service';
import { DocumentDecisionDto, KycDecisionDto } from '../dto/admin.dto';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/kyc')
export class AdminKycController {
  constructor(private readonly svc: AdminKycService) {}

  @Get('queue')
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('statuses') statuses?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.listQueue({
      limit: limit ? Number(limit) : undefined,
      cursor,
      statuses,
      from,
      to,
    });
  }

  @Get('users/:userId')
  detail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.detail(userId);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KycDecisionDto,
  ) {
    return this.svc.decide(user.sub, id, dto);
  }

  @Post('documents/:documentId/decision')
  @HttpCode(200)
  decideDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: DocumentDecisionDto,
  ) {
    return this.svc.decideDocument(user.sub, documentId, dto);
  }
}
