import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ElevationGuard, RequiresElevation } from '../elevation/elevation.guard';
import { CardsService } from './cards.service';
import { OrderCardDto } from './dto/card.dto';

function toDto(card: Awaited<ReturnType<CardsService['getForUser']>>) {
  return {
    id: card.id,
    accountId: card.accountId,
    type: card.type,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    status: card.status,
    spendingLimitCents: card.spendingLimitCents?.toString() ?? null,
    issuedAt: card.issuedAt.toISOString(),
    activatedAt: card.activatedAt ? card.activatedAt.toISOString() : null,
    frozenAt: card.frozenAt ? card.frozenAt.toISOString() : null,
  };
}

@UseGuards(JwtAccessGuard, ElevationGuard)
@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.cards.listForUser(user.sub);
    return rows.map((c) => toDto(c as any));
  }

  @Get(':id')
  async get(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.cards.getForUser(user.sub, id));
  }

  @Post(':id/freeze')
  @HttpCode(200)
  async freeze(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.cards.setStatus(user.sub, id, 'frozen'));
  }

  @Post(':id/unfreeze')
  @HttpCode(200)
  async unfreeze(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.cards.setStatus(user.sub, id, 'active'));
  }

  @Post(':id/reveal')
  @RequiresElevation('card:reveal')
  @HttpCode(200)
  async reveal(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.cards.reveal(user.sub, id);
    return { ...data, ttlSeconds: 30 };
  }

  @Post(':id/replace')
  @HttpCode(201)
  async replace(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.cards.replaceVirtual(user.sub, id));
  }

  @Post('orders')
  @HttpCode(201)
  order(@CurrentUser() user: CurrentUserPayload, @Body() dto: OrderCardDto) {
    return this.cards.orderPhysical(user.sub, dto.accountId, dto.shipAddress);
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.cards.activate(user.sub, id));
  }
}
