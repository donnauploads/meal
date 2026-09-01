import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from './decorators/current-user.decorator';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaResendDto } from './dto/mfa-resend.dto';
import { RefreshDto } from './dto/refresh.dto';
import { FirstLoginPasswordDto, PasswordChangeDto } from './dto/password-change.dto';
import { PrismaService } from '../../prisma/prisma.service';

function readIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xff || req.ip || req.socket.remoteAddress || '0.0.0.0';
}

function readClientCtx(req: Request) {
  return {
    ip: readIp(req),
    userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
    acceptLanguage: (req.headers['accept-language'] as string | undefined) ?? '',
    timezone: (req.headers['x-timezone'] as string | undefined) ?? '',
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = { ...readClientCtx(req), timezone: dto.timezone ?? '', canvasHash: dto.canvasHash };
    const out = await this.auth.login(dto.email, dto.password, ctx);
    if (out.stage === 'session') this.setAuthCookies(req, res, out.accessToken, out.refreshToken);
    return out;
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(@Body() dto: MfaVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = readClientCtx(req);
    const out = await this.auth.mfaVerify(dto.mfaToken, dto.code, ctx);
    this.setAuthCookies(req, res, out.accessToken, out.refreshToken);
    return out;
  }

  @Public()
  @Post('mfa/resend')
  @HttpCode(200)
  async mfaResend(@Body() dto: MfaResendDto) {
    return this.auth.mfaResend(dto.mfaToken);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = dto.refreshToken || req.cookies?.refresh_token;
    if (!presented) throw new UnauthorizedException('No refresh token');
    const out = await this.auth.refresh(presented);
    this.setAuthCookies(req, res, out.accessToken, out.refreshToken);
    return { accessToken: out.accessToken, refreshToken: out.refreshToken, sessionId: out.session.id };
  }

  @UseGuards(JwtAccessGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: CurrentUserPayload, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sid, user.sub);
    this.clearAuthCookies(res);
  }

  @UseGuards(JwtAccessGuard)
  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: PasswordChangeDto,
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!u) throw new ForbiddenException('User not found');
    await this.auth.changePassword(u, dto.currentPassword, dto.newPassword, user.sid);
  }

  /**
   * First-login password set for admin-provisioned accounts. The caller is
   * already authenticated and flagged securitySetupRequired, so no current
   * password is required — they just choose a personal one.
   */
  @UseGuards(JwtAccessGuard)
  @Post('password/first-login')
  @HttpCode(204)
  async firstLoginPassword(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: FirstLoginPasswordDto,
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!u) throw new ForbiddenException('User not found');
    await this.auth.setFirstLoginPassword(u, dto.newPassword, user.sid);
  }

  /**
   * Auth-cookie attributes, derived from the incoming request.
   *
   * The frontend can live on a different site than the API (Vercel UI
   * pointed at an ngrok / production API). In that case the browser
   * refuses to send the cookie on cross-site fetches unless it was set
   * with `SameSite=None; Secure`. We detect cross-site by comparing the
   * caller's Origin host to the API's own Host header — if they differ,
   * we widen the cookie. Same-site requests keep the safer
   * `SameSite=Lax` default.
   */
  private cookieOpts(maxAgeMs: number, req: Request) {
    const prod = this.config.get<string>('NODE_ENV') === 'production';
    const crossSite = isCrossSite(req);
    const sameSite: 'lax' | 'none' = crossSite ? 'none' : 'lax';
    // SameSite=None is only honored when the cookie is also Secure. Most
    // browsers also require a secure context (https) for cross-site
    // cookies to be sent back. ngrok / Vercel both serve over https, so
    // forcing `secure: true` when crossSite is fine.
    const secure = sameSite === 'none' ? true : prod;
    return {
      httpOnly: true,
      sameSite,
      secure,
      maxAge: maxAgeMs,
      path: '/',
    };
  }

  private setAuthCookies(req: Request, res: Response, access: string, refresh: string) {
    res.cookie('access_token', access, this.cookieOpts(15 * 60 * 1000, req));
    res.cookie('refresh_token', refresh, this.cookieOpts(30 * 24 * 60 * 60 * 1000, req));
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }
}

/**
 * Is the inbound request from a different site than the API host?
 * Returns true when the Origin header's host differs from the API's own
 * Host header — that's the cookie-strip condition the browser applies
 * for SameSite=Lax cookies.
 */
function isCrossSite(req: Request): boolean {
  const origin = (req.headers.origin as string | undefined) ?? '';
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const apiHost = (req.headers.host as string | undefined) ?? '';
  if (!apiHost) return true;
  return originHost.toLowerCase() !== apiHost.toLowerCase();
}
