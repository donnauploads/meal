import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { AdminUsersService } from './admin-users.service';
import { ChangeRoleDto, CreateAdminUserDto, SearchUsersDto, UpdateAdminUserDto } from '../dto/admin.dto';

class ReasonDto {
  @IsString() @MaxLength(280) reason!: string;
}

class SetPasswordDto {
  @IsString() @Length(10, 200) password!: string;
  @IsOptional() @IsBoolean() requireSecuritySetup?: boolean;
  @IsString() @MaxLength(280) reason!: string;
}

class SendMessageDto {
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 1000) body!: string;
  @IsEnum(['notification', 'popup', 'both']) channel!: 'notification' | 'popup' | 'both';
  @IsString() @MaxLength(280) reason!: string;
}

class DeleteUserDto {
  /** Must equal the target user's email — typed-confirmation safeguard. */
  @IsString() @MinLength(3) @MaxLength(254) confirmation!: string;
  @IsString() @MaxLength(280) reason!: string;
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  search(@Query() q: SearchUsersDto) {
    return this.svc.search(q);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateAdminUserDto,
  ) {
    return this.svc.create(user.sub, user.role, dto);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.svc.update(user.sub, user.role, id, dto);
  }

  @Get(':id/sessions')
  sessions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit != null && !Number.isNaN(Number(limit)) ? Number(limit) : 3;
    return this.svc.listSessions(id, n);
  }

  @Post(':id/sessions/revoke-all')
  @HttpCode(200)
  revokeAll(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeAllSessions(user.sub, id);
  }

  @Post(':id/sessions/reset')
  @HttpCode(200)
  resetSessions(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.resetLoginHistory(user.sub, id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.svc.setStatus(user.sub, id, 'active', dto.reason);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.svc.setStatus(user.sub, id, 'frozen', dto.reason);
  }

  @Post(':id/password-reset')
  @HttpCode(200)
  passwordReset(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.svc.forcePasswordReset(user.sub, id, dto.reason);
  }

  @Post(':id/password')
  @HttpCode(200)
  setPassword(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
  ) {
    return this.svc.setPassword(
      user.sub,
      id,
      dto.password,
      !!dto.requireSecuritySetup,
      dto.reason,
    );
  }

  @Post(':id/message')
  @HttpCode(200)
  sendMessage(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.svc.sendDirectMessage(user.sub, id, {
      title: dto.title,
      body: dto.body,
      channel: dto.channel,
      reason: dto.reason,
    });
  }

  @Post(':id/reset-history')
  @HttpCode(200)
  resetHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.svc.resetHistory(user.sub, user.role, id, dto.reason);
  }

  /**
   * Hard-delete a user and every owned row. Admin or superadmin — but the
   * service enforces that admins can only delete non-admin accounts; only
   * a superadmin can delete another admin/superadmin.
   * Body must include `confirmation` matching the user's email exactly
   * (case-insensitive) — protects against accidental clicks.
   */
  @Delete(':id')
  @Roles(UserRole.admin, UserRole.superadmin)
  @HttpCode(200)
  hardDelete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteUserDto,
  ) {
    return this.svc.hardDelete(user.sub, user.role, id, dto.confirmation, dto.reason);
  }

  @Post(':id/role')
  @Roles(UserRole.superadmin)
  @HttpCode(200)
  changeRole(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.svc.changeRole(user.sub, user.role, id, dto);
  }

  /**
   * Admin-controlled lock on every form of money movement for this
   * user (P2P, internal, wire_out, ACH, goals, recurring). Toggling
   * doesn't touch sessions, balances or KYC — it's purely a guard the
   * transfer pipeline reads on every initiate.
   */
  @Post(':id/transfers-block')
  @HttpCode(200)
  toggleTransfersBlock(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { disabled: boolean; reason?: string },
  ) {
    return this.svc.setTransfersDisabled(user.sub, id, !!dto.disabled, dto.reason);
  }

  /**
   * Admin kill switch on every notification email for this user
   * (transaction alerts, security alerts, support replies, marketing).
   * Auth-critical mail — MFA codes, password resets, signup verification —
   * still delivers; EmailService enforces the split centrally.
   */
  @Post(':id/email-notifications')
  @HttpCode(200)
  toggleEmailNotifications(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { disabled: boolean; reason?: string },
  ) {
    return this.svc.setEmailNotificationsDisabled(user.sub, id, !!dto.disabled, dto.reason);
  }
}
