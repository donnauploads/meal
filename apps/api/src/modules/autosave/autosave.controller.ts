import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AutosaveService } from './autosave.service';
import { UpdateAutosaveDto } from './dto/autosave.dto';

function toDto(c: Awaited<ReturnType<AutosaveService['upsert']>> | null) {
  if (!c) return null;
  return {
    enabled: c.enabled,
    roundUpEnabled: c.roundUpEnabled,
    roundUpSourceAccountId: c.roundUpSourceAccountId,
    splits: c.splits,
    weeklyContributionCents: c.weeklyContributionCents ? c.weeklyContributionCents.toString() : null,
    weeklyDay: c.weeklyDay,
  };
}

@UseGuards(JwtAccessGuard)
@Controller('autosave')
export class AutosaveController {
  constructor(private readonly autosave: AutosaveService) {}

  @Get()
  async get(@CurrentUser() user: CurrentUserPayload) {
    return toDto(await this.autosave.get(user.sub));
  }

  @Put()
  async update(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateAutosaveDto) {
    return toDto(await this.autosave.upsert(user.sub, dto));
  }
}
