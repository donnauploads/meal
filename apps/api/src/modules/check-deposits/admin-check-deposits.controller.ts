import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CheckDepositsService } from './check-deposits.service';

class RejectDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class ListQueryDto {
  @IsOptional()
  @IsString()
  status?: 'pending' | 'approved' | 'rejected' | 'all';
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/check-deposits')
export class AdminCheckDepositsController {
  constructor(private readonly checks: CheckDepositsService) {}

  @Get()
  list(@Query() q: ListQueryDto) {
    return this.checks.listForAdmin(q.status ?? 'pending');
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.checks.approve(user.sub, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ) {
    return this.checks.reject(user.sub, id, dto.reason);
  }
}
