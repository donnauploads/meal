import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { SignupService } from './signup.service';
import { VerificationService } from './verification.service';
import { SendVerificationDto } from './dto/send-verification.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerificationChannel } from '@prisma/client';

@Public()
@Controller('auth/signup')
export class VerificationController {
  constructor(
    private readonly signup: SignupService,
    private readonly verification: VerificationService,
  ) {}

  @Post(':id/verification/send')
  @HttpCode(200)
  async send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendVerificationDto) {
    const session = await this.signup.load(id);
    const result = await this.verification.send(session, dto.channel as VerificationChannel);
    await this.signup.markChannelChosen(session);
    return result;
  }

  @Post(':id/verification/verify')
  @HttpCode(200)
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyCodeDto) {
    const session = await this.signup.load(id);
    const channel = await this.verification.verify(session, dto.verificationId, dto.code);
    await this.signup.markVerified(session, channel);
    return { ok: true, verifiedChannel: channel };
  }

  @Post(':id/verification/resend')
  @HttpCode(200)
  async resend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResendVerificationDto) {
    const session = await this.signup.load(id);
    const result = await this.verification.resend(session, dto.verificationId);
    return result;
  }
}
