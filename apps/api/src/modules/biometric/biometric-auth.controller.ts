import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { IsDefined, IsEmail, IsObject, IsOptional, IsUUID } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { SessionsService } from '../sessions/sessions.service';
import { BiometricService } from './biometric.service';

class BeginAuthBody {
  @IsOptional()
  @IsEmail()
  email?: string;
}

class FinishAuthBody {
  @IsUUID()
  handle!: string;

  @IsDefined()
  @IsObject()
  response!: Record<string, unknown>;
}

function readIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xff || req.ip || req.socket.remoteAddress || '0.0.0.0';
}

@Public()
@Controller('auth/biometric')
export class BiometricAuthController {
  constructor(
    private readonly bio: BiometricService,
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  @Post('begin')
  @HttpCode(200)
  begin(@Req() req: Request, @Body() dto: BeginAuthBody) {
    return this.bio.beginAuthentication(req.headers.origin, dto.email);
  }

  @Post('finish')
  @HttpCode(200)
  async finish(
    @Body() dto: FinishAuthBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = await this.bio.finishAuthentication(
      dto.handle,
      dto.response,
      req.headers.origin,
    );

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Account not available');
    }

    const ctx = {
      userId,
      ip: readIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
      acceptLanguage: (req.headers['accept-language'] as string | undefined) ?? '',
      timezone: (req.headers['x-timezone'] as string | undefined) ?? '',
    };
    const device = await this.devices.upsertOnLogin(ctx);
    // Biometric proves possession of a strong authenticator on this device,
    // so we promote it to trusted (skips SMS MFA on subsequent password logins).
    await this.devices.markTrusted(device.id);

    const issued = await this.sessions.issueSession({
      userId,
      deviceId: device.id,
      role: user.role,
      ip: ctx.ip,
    });

    this.setAuthCookies(res, issued.accessToken, issued.refreshToken);
    return {
      stage: 'session' as const,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.session.id,
    };
  }

  private setAuthCookies(res: Response, access: string, refresh: string) {
    const prod = this.config.get<string>('NODE_ENV') === 'production';
    const base = { httpOnly: true, sameSite: 'lax' as const, secure: prod, path: '/' };
    res.cookie('access_token', access, { ...base, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refresh, { ...base, maxAge: 30 * 24 * 60 * 60 * 1000 });
  }
}
