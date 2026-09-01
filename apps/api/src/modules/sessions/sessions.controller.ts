import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SessionRevokedReason } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { SessionsService } from './sessions.service';

@Controller('auth/sessions')
@UseGuards(JwtAccessGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.sessions.listForUser(user.sub);
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      revokedReason: s.revokedReason,
      current: s.id === user.sid,
      device: {
        id: s.device.id,
        name: s.device.name,
        os: s.device.os,
        browser: s.device.browser,
        ipLastSeen: s.device.ipLastSeen,
        locationLastSeen: s.device.locationLastSeen,
        trusted: s.device.trusted,
        lastSeenAt: s.device.lastSeenAt,
      },
    }));
  }

  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    await this.sessions.revokeOne(id, user.sub, SessionRevokedReason.user_signout);
  }
}
