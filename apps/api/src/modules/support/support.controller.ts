import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
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
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { SupportService, attachmentDto } from './support.service';
import { streamAttachment } from './support.http';

class PostMessageDto {
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

// Guard rail above the service's precise size check so multer buffers a
// slightly larger file and the service returns the friendly "10MB" message.
const UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;

@UseGuards(JwtAccessGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Opens (or returns) the customer's rolling support thread. */
  @Get('thread')
  async myThread(@CurrentUser() user: CurrentUserPayload) {
    const thread = await this.support.openOrGetCustomerThread(user.sub);
    return {
      id: thread.id,
      status: thread.status,
      createdAt: thread.createdAt.toISOString(),
    };
  }

  @Get('thread/:id/messages')
  async messages(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const rows = await this.support.listCustomerMessages(user.sub, id);
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

  /** Customer-side: mark every admin reply in the thread as read. */
  @Post('thread/:id/read')
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.markAdminMessagesRead(user.sub, id);
  }

  @Post('thread/:id/messages')
  async send(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
  ) {
    const message = await this.support.postCustomerMessage(
      user.sub,
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
      attachment: attachmentDto(message),
    };
  }

  /** Upload a single file (image / PDF / Word doc) into the thread. The file
   *  is validated + re-encoded server-side before it's ever stored. */
  @Post('thread/:id/attachment')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }),
  )
  async attach(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: AttachmentDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const message = await this.support.postCustomerAttachment(
      user.sub,
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
      attachment: attachmentDto(message),
    };
  }

  /** Authenticated, thread-scoped download of an attachment's bytes. */
  @Get('thread/:id/attachment/:messageId')
  async download(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() res: Response,
  ) {
    const loaded = await this.support.loadAttachmentForUser(
      user.sub,
      id,
      messageId,
    );
    streamAttachment(res, loaded);
  }
}
