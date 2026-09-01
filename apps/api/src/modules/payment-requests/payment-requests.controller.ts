import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PaymentRequestsService } from './payment-requests.service';
import { CreatePaymentRequestDto } from '../pay/dto/pay.dto';
import { IsUUID } from 'class-validator';

class PayRequestBody {
  @IsUUID()
  fromAccountId!: string;
}

@UseGuards(JwtAccessGuard)
@Controller('payment-requests')
export class PaymentRequestsController {
  constructor(private readonly svc: PaymentRequestsService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePaymentRequestDto) {
    return this.svc.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserPayload, @Query('role') role: 'inbox' | 'sent' = 'inbox') {
    return this.svc.list(user.sub, role);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.decline(user.sub, id);
  }

  @Post(':id/pay')
  pay(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: PayRequestBody,
  ) {
    return this.svc.pay(user.sub, id, idempotencyKey, body.fromAccountId);
  }
}
