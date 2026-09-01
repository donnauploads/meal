import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CheckDepositsService } from './check-deposits.service';

class SubmitCheckDto {
  @IsDefined()
  @Transform(({ value }) =>
    typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0),
  )
  amountCents!: bigint;

  // The amount the customer typed on the form, in their display currency's
  // minor units. Stored so decision emails show exactly what they selected.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? null
      : BigInt(value),
  )
  displayAmountCents?: bigint | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  displayCurrency?: string;
}

@UseGuards(JwtAccessGuard)
@Controller('check-deposits')
export class CheckDepositsController {
  constructor(private readonly checks: CheckDepositsService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
      ],
      { limits: { fileSize: 10 * 1024 * 1024 } },
    ),
  )
  async submit(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SubmitCheckDto,
    @UploadedFiles()
    files: { front?: Express.Multer.File[]; back?: Express.Multer.File[] },
  ) {
    const front = files?.front?.[0];
    const back = files?.back?.[0];
    if (!front) throw new BadRequestException('front image is required');
    if (!back) throw new BadRequestException('back image is required');

    return this.checks.submit({
      userId: user.sub,
      amountCents: dto.amountCents,
      displayAmountCents: dto.displayAmountCents ?? null,
      displayCurrency: dto.displayCurrency ?? null,
      front: {
        contentType: front.mimetype,
        bytes: front.buffer,
        originalName: front.originalname,
      },
      back: {
        contentType: back.mimetype,
        bytes: back.buffer,
        originalName: back.originalname,
      },
    });
  }
}
