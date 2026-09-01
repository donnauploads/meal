import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { LinkedAccountAuthService } from './linked-account-auth.service';

class RejectDto {
  @IsString() @MaxLength(280) reason!: string;
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/linked-account-requests')
export class AdminLinkRequestsController {
  constructor(private readonly svc: LinkedAccountAuthService) {}

  @Get()
  list() {
    return this.svc.listPending();
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approve(user.sub, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ) {
    return this.svc.reject(user.sub, id, dto.reason);
  }

  /**
   * Hard-delete a link request. The customer's pending list updates
   * live via the `linkedAccount.changed` push from the realtime gateway.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.svc.deleteByAdmin(user.sub, id);
  }
}
