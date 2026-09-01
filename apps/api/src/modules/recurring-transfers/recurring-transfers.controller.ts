import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ElevationGuard, RequiresElevation } from '../elevation/elevation.guard';
import { RecurringTransfersService } from './recurring-transfers.service';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';

@UseGuards(JwtAccessGuard, ElevationGuard)
@Controller('recurring-transfers')
export class RecurringTransfersController {
  constructor(private readonly svc: RecurringTransfersService) {}

  // Creating a recurring schedule authorizes future money movement, so
  // it requires the same `transfer:authorize` elevation that one-off
  // transfers do — PIN or biometric verification gates it.
  @Post()
  @RequiresElevation('transfer:authorize')
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateRecurringDto) {
    const r = await this.svc.create(user.sub, dto);
    return this.toDto(r);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.svc.list(user.sub);
    return rows.map((r) => this.toDto(r));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringDto,
  ) {
    return this.toDto(await this.svc.update(user.sub, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  cancel(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(user.sub, id);
  }

  private toDto(r: Awaited<ReturnType<RecurringTransfersService['create']>>) {
    return {
      id: r.id,
      fromAccountId: r.fromAccountId,
      toAccountId: r.toAccountId,
      amountCents: r.amountCents.toString(),
      frequency: r.frequency,
      dayOf: r.dayOf,
      active: r.active,
      nextRunAt: r.nextRunAt.toISOString(),
      lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    };
  }
}
