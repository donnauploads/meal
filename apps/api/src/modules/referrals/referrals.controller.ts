import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';
import { CreateInviteDto } from './dto/referrals.dto';

@UseGuards(JwtAccessGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly config: ConfigService,
  ) {}

  @Post('invite')
  @HttpCode(201)
  async invite(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateInviteDto) {
    const row = await this.referrals.invite(user.sub, dto);
    const webBase = this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000';
    return {
      id: row.id,
      code: row.code,
      inviteUrl: `${webBase}/get-started?ref=${row.code}`,
      status: row.status,
      invitedEmail: row.invitedEmail,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.referrals.listForUser(user.sub);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      invitedEmail: r.invitedEmail,
      invitedUserId: r.invitedUserId,
      payoutCents: r.payoutCents ? r.payoutCents.toString() : null,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      qualifiedAt: r.qualifiedAt ? r.qualifiedAt.toISOString() : null,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    }));
  }
}
