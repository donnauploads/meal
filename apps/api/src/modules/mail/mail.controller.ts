import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { MailService, StagedAttachment } from './mail.service';
import { MAIL_DESKS, MAIL_THREAD_STATUSES, MailDesk } from './mail.types';
import { getDeskIdentities } from './mail-desks';

class StagedAttachmentDto implements StagedAttachment {
  @IsString() @MaxLength(512) storageKey!: string;
  @IsString() @MaxLength(255) filename!: string;
  @IsString() @MaxLength(255) contentType!: string;
  @IsInt() sizeBytes!: number;
}

class ComposeDto {
  @IsIn(MAIL_DESKS as unknown as string[]) desk!: MailDesk;
  @IsOptional() @IsUUID() toUserId?: string;
  @IsEmail() toEmail!: string;
  @IsOptional() @IsString() @MaxLength(200) toName?: string;
  @IsString() @MinLength(1) @MaxLength(300) subject!: string;
  @IsOptional() @IsString() @MaxLength(300) greeting?: string;
  @IsString() @MinLength(1) @MaxLength(100_000) bodyHtml!: string;
  @IsOptional() @IsString() @MaxLength(2_000) signature?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StagedAttachmentDto)
  attachments?: StagedAttachmentDto[];
}

class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(100_000) bodyHtml!: string;
  @IsOptional() @IsString() @MaxLength(2_000) signature?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StagedAttachmentDto)
  attachments?: StagedAttachmentDto[];
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('admin/mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  /** The 3 sender identities for the composer's desk picker. */
  @Get('desks')
  desks() {
    const ids = getDeskIdentities();
    return MAIL_DESKS.map((d) => ({
      desk: d,
      label: ids[d].label,
      fromEmail: ids[d].fromEmail,
      fromName: ids[d].fromName,
    }));
  }

  @Get('threads')
  async threads(
    @Query('desk') desk?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    const rows = await this.mail.listThreads({
      desk: (MAIL_DESKS as readonly string[]).includes(desk ?? '')
        ? (desk as MailDesk)
        : undefined,
      status: (MAIL_THREAD_STATUSES as readonly string[]).includes(status ?? '')
        ? (status as 'open' | 'closed')
        : undefined,
      q,
    });
    return rows.map((t: any) => this.threadDto(t));
  }

  @Get('threads/:id/messages')
  async messages(@Param('id', ParseUUIDPipe) id: string) {
    const thread = await this.mail.getThread(id);
    const rows = await this.mail.getMessages(id);
    return {
      thread: this.threadDto(thread),
      messages: rows.map((m: any) => this.messageDto(m)),
    };
  }

  @Post('send')
  async send(@CurrentUser() admin: CurrentUserPayload, @Body() dto: ComposeDto) {
    const { thread, message } = await this.mail.compose({
      adminId: admin.sub,
      desk: dto.desk,
      toUserId: dto.toUserId ?? null,
      toEmail: dto.toEmail,
      toName: dto.toName ?? null,
      subject: dto.subject,
      greeting: dto.greeting,
      bodyHtml: dto.bodyHtml,
      signature: dto.signature,
      attachments: dto.attachments,
    });
    return { thread: this.threadDto(thread), message: this.messageDto(message) };
  }

  @Post('threads/:id/reply')
  async reply(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ) {
    const { message } = await this.mail.reply({
      adminId: admin.sub,
      threadId: id,
      bodyHtml: dto.bodyHtml,
      signature: dto.signature,
      attachments: dto.attachments,
    });
    return this.messageDto(message);
  }

  @Post('threads/:id/close')
  async close(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.mail.closeThread(id);
    return { id: t.id, status: t.status };
  }

  @Post('threads/:id/reopen')
  async reopen(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.mail.reopenThread(id);
    return { id: t.id, status: t.status };
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { ok: false, error: 'no file' };
    return this.mail.stageAttachment(file);
  }

  @Get('attachments/:id')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const att = await this.mail.getAttachmentForDownload(id);
    res.setHeader('Content-Type', att.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${att.filename.replace(/"/g, '')}"`,
    );
    return new StreamableFile(att.bytes);
  }

  // ─── serializers ──────────────────────────────────────────────────────

  private threadDto(t: any) {
    return {
      id: t.id,
      userId: t.userId ?? null,
      toEmail: t.toEmail,
      toName: t.toName ?? null,
      desk: t.desk,
      subject: t.subject,
      status: t.status,
      unread: t.unreadForAdmins,
      lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      lastSnippet: t.lastSnippet ?? null,
      lastDirection: t.lastDirection ?? null,
    };
  }

  private messageDto(m: any) {
    return {
      id: m.id,
      threadId: m.threadId,
      direction: m.direction,
      desk: m.desk,
      fromEmail: m.fromEmail,
      fromName: m.fromName ?? null,
      toEmail: m.toEmail,
      subject: m.subject,
      bodyHtml: m.bodyHtml,
      bodyText: m.bodyText,
      createdAt: m.createdAt.toISOString(),
      attachments: (m.attachments ?? []).map((a: any) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    };
  }
}
