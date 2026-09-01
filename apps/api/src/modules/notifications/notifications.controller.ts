import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsUUID } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto, UpdatePreferencesDto } from './dto/notifications.dto';

class MarkReadBody {
  @IsArray()
  @IsUUID('all', { each: true })
  ids!: string[];
}

@UseGuards(JwtAccessGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() query: ListNotificationsDto) {
    const rows = await this.notifications.list(user.sub, query);
    return rows.map((n) => ({
      id: n.id,
      category: n.category,
      title: n.title,
      body: n.body,
      ctaUrl: n.ctaUrl,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return { count: await this.notifications.unreadCount(user.sub) };
  }

  @Post('read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: CurrentUserPayload, @Body() body: MarkReadBody) {
    const count = await this.notifications.markRead(user.sub, body.ids);
    return { updated: count };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: CurrentUserPayload) {
    const count = await this.notifications.markAllRead(user.sub);
    return { updated: count };
  }

  @Delete()
  @HttpCode(200)
  async clearAll(@CurrentUser() user: CurrentUserPayload) {
    const count = await this.notifications.clearAll(user.sub);
    return { deleted: count };
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: CurrentUserPayload) {
    const p = await this.notifications.getPreferences(user.sub);
    return {
      txAll: p.txAll,
      txLargeOnly: p.txLargeOnly,
      txLargeThresholdCents: p.txLargeThresholdCents.toString(),
      securityAlerts: p.securityAlerts,
      marketingEmail: p.marketingEmail,
      marketingPush: p.marketingPush,
    };
  }

  @Put('preferences')
  async updatePreferences(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdatePreferencesDto) {
    const p = await this.notifications.updatePreferences(user.sub, dto);
    return {
      txAll: p.txAll,
      txLargeOnly: p.txLargeOnly,
      txLargeThresholdCents: p.txLargeThresholdCents.toString(),
      securityAlerts: p.securityAlerts,
      marketingEmail: p.marketingEmail,
      marketingPush: p.marketingPush,
    };
  }
}
