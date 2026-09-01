import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { TransactionPinService } from './transaction-pin.service';

class SetPinDto {
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4-6 digits' })
  newPin!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'Current PIN must be 4-6 digits' })
  currentPin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  currentPassword?: string;
}

const VERIFY_SCOPES = ['transfer:authorize', 'profile:edit', 'card:reveal'] as const;

class VerifyPinDto {
  @IsString()
  @Length(4, 6)
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4-6 digits' })
  pin!: string;

  @IsOptional()
  @IsIn(VERIFY_SCOPES as unknown as readonly string[])
  scope?: (typeof VERIFY_SCOPES)[number];
}

@UseGuards(JwtAccessGuard)
@Controller('me/security/transaction-pin')
export class TransactionPinController {
  constructor(private readonly pin: TransactionPinService) {}

  /** Tells the FE whether to route the user through setup vs verify. */
  @Get()
  async status(@CurrentUser() user: CurrentUserPayload) {
    return { enabled: await this.pin.hasPin(user.sub) };
  }

  /** First-time setup or rotation. Body shape matches both. */
  @Post()
  @HttpCode(204)
  async set(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SetPinDto,
  ): Promise<void> {
    await this.pin.setPin({
      userId: user.sub,
      newPin: dto.newPin,
      currentPin: dto.currentPin,
      currentPassword: dto.currentPassword,
    });
  }

  /** Returns a short-lived elevation token scoped transfer:authorize. */
  @Post('verify')
  @HttpCode(200)
  async verify(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: VerifyPinDto,
  ) {
    const scope = dto.scope ?? 'transfer:authorize';
    const elevationToken = await this.pin.verifyPin(user.sub, dto.pin, scope);
    return { elevationToken, scope };
  }
}
