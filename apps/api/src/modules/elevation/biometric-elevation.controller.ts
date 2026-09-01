import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { IsDefined, IsObject, IsUUID } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { BiometricService } from '../biometric/biometric.service';
import { ElevationService } from './elevation.service';

class FinishBody {
  @IsUUID()
  handle!: string;

  @IsDefined()
  @IsObject()
  response!: Record<string, unknown>;
}

/**
 * Elevation via WebAuthn assertion. Mirrors the structure of the
 * passwordless sign-in (`/auth/biometric`) endpoints, but for an
 * already-authenticated user — the verify step issues a short-lived
 * elevation JWT scoped to `transfer:authorize` instead of a full
 * session.
 *
 * The flow:
 *   1. FE calls /begin → returns { handle, options } from the same
 *      BiometricService that backs sign-in.
 *   2. FE prompts the OS via navigator.credentials.get(publicKey).
 *   3. FE calls /verify with the assertion. Service confirms the
 *      assertion belongs to the signed-in user; controller mints the
 *      elevation token.
 */
@UseGuards(JwtAccessGuard)
@Controller('me/security/elevate/biometric')
export class BiometricElevationController {
  constructor(
    private readonly bio: BiometricService,
    private readonly elevation: ElevationService,
  ) {}

  @Post('begin')
  @HttpCode(200)
  begin(@Req() req: Request) {
    return this.bio.beginAuthentication(req.headers.origin);
  }

  @Post('verify')
  @HttpCode(200)
  async verify(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: FinishBody,
    @Req() req: Request,
  ) {
    const { userId } = await this.bio.finishAuthentication(
      dto.handle,
      dto.response,
      req.headers.origin,
    );
    if (userId !== user.sub) {
      // User A can't elevate by presenting User B's credential, even if
      // both share a device. Reject crisply rather than silently
      // re-attributing the assertion.
      throw new ForbiddenException(
        'Biometric credential belongs to a different account',
      );
    }
    const elevationToken = this.elevation.signElevation(
      user.sub,
      'transfer:authorize',
    );
    return { elevationToken, scope: 'transfer:authorize' as const };
  }
}
