import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { toAccountDto, toLimitsDto } from './dto/account.dto';

@UseGuards(JwtAccessGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.accounts.list(user.sub);
    return rows.map(toAccountDto);
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return toAccountDto(await this.accounts.getForUser(id, user.sub));
  }

  @Get(':id/limits')
  async limits(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return toLimitsDto(await this.accounts.getLimits(id, user.sub));
  }
}
