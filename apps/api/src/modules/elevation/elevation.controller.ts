import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DevicesService } from '../devices/devices.service';
import { parseUaSummary } from '../devices/fingerprint.util';
import { ElevationService } from './elevation.service';
import { BeginElevationDto, VerifyElevationDto } from './dto/elevation.dto';

function readIp(req: Request): string {
  return ((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || '0.0.0.0');
}

@UseGuards(JwtAccessGuard)
@Controller('me/security')
export class ElevationController {
  constructor(
    private readonly elevation: ElevationService,
    private readonly devices: DevicesService,
  ) {}

  @Post('elevate/begin')
  @HttpCode(200)
  async begin(@CurrentUser() user: CurrentUserPayload, @Body() dto: BeginElevationDto, @Req() req: Request) {
    const ua = (req.headers['user-agent'] as string | undefined) ?? '';
    const summary = parseUaSummary(ua);
    const fingerprint = this.devices.fingerprint({
      userAgent: ua,
      acceptLanguage: (req.headers['accept-language'] as string | undefined) ?? '',
      timezone: (req.headers['x-timezone'] as string | undefined) ?? '',
    });
    return this.elevation.beginChallenge(user.sub, dto.scope, {
      fingerprint,
      name: summary.name,
      os: summary.os,
      browser: summary.browser,
      ip: readIp(req),
    });
  }

  @Post('elevate/verify')
  @HttpCode(200)
  async verify(@CurrentUser() user: CurrentUserPayload, @Body() dto: VerifyElevationDto) {
    const elevationToken = await this.elevation.verifyChallenge(user.sub, dto.challengeId, dto.code, dto.scope);
    return { elevationToken, scope: dto.scope };
  }
}
