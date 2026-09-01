import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { InsightsService } from './insights.service';

@UseGuards(JwtAccessGuard)
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('monthly')
  monthly(
    @CurrentUser() user: CurrentUserPayload,
    @Query('accountId') accountId?: string,
    @Query('months') months?: string,
  ) {
    const m = months ? Math.max(1, Math.min(36, Number(months))) : 12;
    return this.insights.monthly(user.sub, accountId, m);
  }

  @Get('by-category')
  byCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Query('accountId') accountId?: string,
    @Query('monthStart') monthStart?: string,
  ) {
    const ms = monthStart && !Number.isNaN(Date.parse(monthStart)) ? new Date(monthStart) : undefined;
    return this.insights.byCategory(user.sub, accountId, ms);
  }
}
