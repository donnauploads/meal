import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { SupportService, attachmentDto } from './support.service';
import { streamAttachment } from './support.http';

class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

class AttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  caption?: string;
}

const UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;

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
      attachment: attachmentDto(m),
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
      attachment: attachmentDto(message),
    };
  }

  /** Admin uploads a single file into a thread (validated + re-encoded). */
  @Post('threads/:id/attachment')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }),
  )
  async attach(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: AttachmentDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const message = await this.support.postAdminAttachment(
      admin.sub,
      id,
      dto.caption ?? '',
      { originalname: file.originalname, mimetype: file.mimetype, buffer: file.buffer },
    );
    return {
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      readAt: (message as { readAt?: Date | null }).readAt?.toISOString() ?? null,
      attachment: attachmentDto(message),
    };
  }

  /** Authenticated download of a thread attachment (admins read any thread). */
  @Get('threads/:id/attachment/:messageId')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() res: Response,
  ) {
    const loaded = await this.support.loadAttachmentForAdmin(id, messageId);
    streamAttachment(res, loaded);
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
