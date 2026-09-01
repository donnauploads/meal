import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { SupportService } from './support.service';

class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('threads')
  async threads() {
    const rows = await this.support.listAdminThreads();
    return rows.map((t) => ({
      id: t.id,
      userId: t.userId,
      customerName: t.customerName,
      customerEmail: t.customerEmail,
      lastBody: t.lastBody,
      status: t.status,
      unread: t.unreadForAdmins,
      lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      lastIp: t.lastIp,
      lastGeo: t.lastGeo,
    }));
  }

  @Get('threads/:id/messages')
  async messages(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.support.listAdminMessages(id);
    return rows.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      senderId: m.senderId,
      senderRole: m.senderRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: (m as { readAt?: Date | null }).readAt?.toISOString() ?? null,
    }));
  }

  @Post('threads/:id/reply')
  async reply(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ) {
    const message = await this.support.postAdminMessage(
      admin.sub,
      id,
      dto.body,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      readAt: (message as { readAt?: Date | null }).readAt?.toISOString() ?? null,
    };
  }

  @Post('threads/:id/close')
  async close(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const thread = await this.support.closeThread(id, admin.sub);
    return { id: thread.id, status: thread.status }
  }

  @Post('threads/:id/reopen')
  async reopen(@Param('id', ParseUUIDPipe) id: string) {
    const thread = await this.support.reopenThread(id);
    return { id: thread.id, status: thread.status }
  }
}
