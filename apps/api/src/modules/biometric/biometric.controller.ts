import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsDefined, IsObject, IsUUID } from 'class-validator';
import { Request } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { BiometricService } from './biometric.service';

class FinishBody {
  @IsUUID()
  deviceId!: string;

  // WebAuthn attestation envelope — opaque to validation, verified by
  // @simplewebauthn/server inside BiometricService.finishRegistration.
  @IsDefined()
  @IsObject()
  response!: Record<string, unknown>;
}

class ReactivateBody {
  @IsUUID()
  deviceId!: string;
}

@UseGuards(JwtAccessGuard)
@Controller('me/biometric')
export class BiometricController {
  constructor(private readonly bio: BiometricService) {}

  @Post('register/begin')
  @HttpCode(200)
  begin(@CurrentUser() user: CurrentUserPayload, @Req() req: Request) {
    return this.bio.beginRegistration(user.sub, req.headers.origin);
  }

  @Post('register/finish')
  @HttpCode(200)
  finish(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: FinishBody,
    @Req() req: Request,
  ) {
    return this.bio.finishRegistration(
      user.sub,
      body.deviceId,
      body.response,
      req.headers.origin,
    );
  }

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.bio.list(user.sub);
  }

  /**
   * Re-enable a previously toggled-off enrollment for this device, no
   * WebAuthn ceremony required. Returns { reactivated: true } when the
   * server flipped the soft-delete flag back, or { reactivated: false }
   * when no dormant enrollment exists (caller should run the rebind
   * flow or a fresh register/begin → register/finish dance instead).
   */
  @Post('reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: ReactivateBody,
  ) {
    const reactivated = await this.bio.reactivate(user.sub, body.deviceId);
    return { reactivated };
  }

  /**
   * Rebind — for the case where the user has a synced OS passkey for
   * State Bank but no usable DB row on this device (different browser,
   * different device, or a leftover hard-delete from before the
   * soft-delete migration). Begin returns auth options; finish accepts
   * the resulting assertion and writes / reactivates the enrollment.
   */
  @Post('rebind/begin')
  @HttpCode(200)
  rebindBegin(@CurrentUser() user: CurrentUserPayload, @Req() req: Request) {
    return this.bio.beginRebind(user.sub, req.headers.origin);
  }

  @Post('rebind/finish')
  @HttpCode(200)
  rebindFinish(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: FinishBody,
    @Req() req: Request,
  ) {
    return this.bio.finishRebind(
      user.sub,
      body.deviceId,
      body.response,
      req.headers.origin,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.bio.remove(user.sub, id);
  }
}
