import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { MeSecurityService } from './me-security.service';
import { TotpService } from './totp.service';
import { TotpDisableDto, TotpVerifyDto } from './dto/me-security.dto';

@UseGuards(JwtAccessGuard)
@Controller('me/security')
export class MeSecurityController {
  constructor(
    private readonly svc: MeSecurityService,
    private readonly totp: TotpService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  overview(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.overview(user.sub);
  }

  @Post('2fa/totp/begin')
  @HttpCode(200)
  async totpBegin(@CurrentUser() user: CurrentUserPayload) {
    const u = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { email: true } });
    return this.totp.begin(user.sub, u?.email ?? user.sub);
  }

  @Post('2fa/totp/verify')
  @HttpCode(200)
  totpVerify(@CurrentUser() user: CurrentUserPayload, @Body() dto: TotpVerifyDto) {
    return this.totp.verify(user.sub, dto.code);
  }

  @Post('2fa/totp/disable')
  @HttpCode(204)
  totpDisable(@CurrentUser() user: CurrentUserPayload, @Body() dto: TotpDisableDto) {
    return this.totp.disable(user.sub, dto.currentCode);
  }
}
