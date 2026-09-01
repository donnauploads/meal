import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { AdminTransactionsService } from './admin-transactions.service';
import { BulkShiftDto, CreateAdminTransactionDto, DeleteAdminTransactionDto, HideTransactionDto, ListAdminTransactionsDto, PatchTransactionDto } from '../dto/admin.dto';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/transactions')
export class AdminTransactionsController {
  constructor(private readonly svc: AdminTransactionsService) {}

  @Get()
  list(@Query() q: ListAdminTransactionsDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getOne(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateAdminTransactionDto,
  ) {
    return this.svc.create(user.sub, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteAdminTransactionDto,
  ) {
    return this.svc.delete(user.sub, id, dto);
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchTransactionDto,
  ) {
    return this.svc.patch(user.sub, id, dto);
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideTransactionDto,
  ) {
    return this.svc.hide(user.sub, id, dto);
  }

  @Delete(':id/override')
  @HttpCode(200)
  clear(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.clearOverride(user.sub, id);
  }

  @Post('bulk-shift')
  @Roles(UserRole.superadmin)
  @HttpCode(200)
  bulkShift(@CurrentUser() user: CurrentUserPayload, @Body() dto: BulkShiftDto) {
    return this.svc.bulkShift(user.sub, user.role, dto);
  }
}
