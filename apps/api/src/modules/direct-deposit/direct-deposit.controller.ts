import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DirectDepositService } from './direct-deposit.service';
import { DirectDepositPdfRenderer } from './pdf.renderer';
import { ActivateWebhookDto, StartSwitchDto } from './dto/direct-deposit.dto';

@UseGuards(JwtAccessGuard)
@Controller('direct-deposit')
export class DirectDepositController {
  constructor(
    private readonly service: DirectDepositService,
    private readonly pdf: DirectDepositPdfRenderer,
  ) {}

  @Get()
  summary(@CurrentUser() user: CurrentUserPayload) {
    return this.service.summary(user.sub);
  }

  @Get('numbers')
  async numbers(@CurrentUser() user: CurrentUserPayload) {
    const acct = await this.service.accountPlain(user.sub);
    return {
      routingNumber: acct.mockRoutingNumber,
      accountNumber: acct.mockAccountNumber,
      accountNumberMasked: `••••${acct.mockAccountNumber.slice(-4)}`,
      accountType: 'checking',
      bankName: 'State Bank',
    };
  }

  @Get('pdf')
  async pdfDocument(@CurrentUser() user: CurrentUserPayload, @Res() res: Response) {
    const acct = await this.service.accountPlain(user.sub);
    const dd = await this.service.summary(user.sub);
    const buf = await this.pdf.render({
      userFullName: [acct.user.firstName, acct.user.lastName].filter(Boolean).join(' ') || acct.user.email,
      routingNumber: acct.mockRoutingNumber,
      accountNumber: acct.mockAccountNumber,
      bankName: 'State Bank',
      employerName: dd.employer?.name,
      asOf: new Date(),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="direct-deposit.pdf"');
    res.send(buf);
  }

  @Post('switch')
  @HttpCode(202)
  startSwitch(@CurrentUser() user: CurrentUserPayload, @Body() dto: StartSwitchDto) {
    return this.service.startSwitch(user.sub, dto);
  }
}

@Public()
@Controller('webhooks/direct-deposit')
export class DirectDepositWebhookController {
  constructor(private readonly service: DirectDepositService) {}

  @Post('activate')
  @HttpCode(200)
  async activate(@Body() dto: ActivateWebhookDto) {
    const dd = await this.service.handleWebhook(dto.partnerRequestId);
    return { active: dd.active, activatedAt: dd.activatedAt?.toISOString() ?? null };
  }
}
