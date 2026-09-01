import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DealsService } from './deals.service';
import { DirectDepositActive, DirectDepositActiveGuard } from './dd-active.guard';

@UseGuards(JwtAccessGuard, DirectDepositActiveGuard)
@DirectDepositActive()
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.deals.list(user.sub);
  }

  @Post(':id/activate')
  @HttpCode(201)
  activate(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.deals.activate(user.sub, id);
  }
}
