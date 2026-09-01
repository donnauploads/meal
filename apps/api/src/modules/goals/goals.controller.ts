import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { GoalsService } from './goals.service';
import { ContributeDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

function toDto(g: Awaited<ReturnType<GoalsService['create']>>) {
  return {
    id: g.id,
    emoji: g.emoji,
    name: g.name,
    targetCents: g.targetCents ? g.targetCents.toString() : null,
    currentCents: g.currentCents.toString(),
    targetDate: g.targetDate ? g.targetDate.toISOString() : null,
    contributePerWeek: g.contributePerWeek ? g.contributePerWeek.toString() : null,
    isDefault: g.isDefault,
    archivedAt: g.archivedAt ? g.archivedAt.toISOString() : null,
  };
}

@UseGuards(JwtAccessGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    return (await this.goals.list(user.sub)).map(toDto);
  }

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateGoalDto) {
    return toDto(await this.goals.create(user.sub, dto));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return toDto(await this.goals.update(user.sub, id, dto));
  }

  @Delete(':id')
  @HttpCode(200)
  async archive(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.goals.archive(user.sub, id));
  }

  @Post(':id/contribute')
  async contribute(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: ContributeDto,
  ) {
    const { goal, transfer } = await this.goals.contribute(
      user.sub,
      id,
      idempotencyKey,
      dto.fromAccountId,
      dto.amountCents,
    );
    return { goal: toDto(goal), transfer };
  }
}
