import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { SupportService } from './support.service';

class PostMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

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
    };
  }
}
