import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PayService } from './pay.service';
import { PayDto } from './dto/pay.dto';
import {
  ElevationGuard,
  RequiresElevation,
} from '../elevation/elevation.guard';

@UseGuards(JwtAccessGuard, ElevationGuard)
@Controller('pay')
export class PayController {
  constructor(
    private readonly pay: PayService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  // Every money-movement endpoint requires the client to first verify a
  // PIN (or biometric / SMS, depending on the user's enrolled factor).
  // The FE attaches the short-lived elevation JWT as `x-elevation`; the
  // guard rejects missing or wrong-scope tokens with 401 before this
  // controller body runs.
  @RequiresElevation('transfer:authorize')
  send(
    @CurrentUser() user: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: PayDto,
  ) {
    return this.pay.pay(user.sub, idempotencyKey, dto);
  }

  @Get('qr')
  async qr(@CurrentUser() user: CurrentUserPayload) {
    const u = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { novaTag: true } });
    return this.pay.qrFor(u?.novaTag ?? null, user.sub);
  }

  @Get('recipients')
  search(
    @CurrentUser() user: CurrentUserPayload,
    @Query('q') q: string,
  ) {
    return this.pay.search(user.sub, q ?? '');
  }
}
