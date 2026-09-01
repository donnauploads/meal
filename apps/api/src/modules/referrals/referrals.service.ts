import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { ReferralStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SIGNUP_COMPLETED_EVENT, SignupCompletedPayload } from '../auth/signup/signup.service';
import { NEST_EVENT, AdminTransferSettledPayload } from '../realtime/events';
import { CreateInviteDto } from './dto/referrals.dto';

function generateCode(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  private readonly codeLength: number;
  private readonly bonusCents: bigint;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.codeLength = Number(config.get('REFERRAL_CODE_LENGTH') ?? 8);
    this.bonusCents = BigInt(config.get<string>('REFERRAL_QUALIFY_BONUS_CENTS') ?? '2500');
  }

  async invite(referrerUserId: string, dto: CreateInviteDto) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.referral.create({
          data: {
            referrerUserId,
            invitedEmail: dto.invitedEmail ?? null,
            code: generateCode(this.codeLength),
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error('Could not allocate unique referral code');
  }

  async listForUser(userId: string) {
    return this.prisma.referral.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveCode(code: string) {
    return this.prisma.referral.findUnique({ where: { code } });
  }

  async attachToSignup(signupId: string, code: string): Promise<void> {
    const referral = await this.resolveCode(code);
    if (!referral) throw new NotFoundException('Invalid referral code');
    if (referral.status !== ReferralStatus.sent) throw new BadRequestException('Referral already used');
    await this.prisma.signupSession.update({
      where: { id: signupId },
      data: { referralCode: code },
    });
  }

  @OnEvent(SIGNUP_COMPLETED_EVENT)
  async onSignupCompleted(payload: SignupCompletedPayload) {
    try {
      const signup = await this.prisma.signupSession.findUnique({ where: { id: payload.signupId } });
      if (!signup?.referralCode) return;
      const referral = await this.prisma.referral.findUnique({ where: { code: signup.referralCode } });
      if (!referral || referral.referrerUserId === payload.userId) return;
      if (referral.status !== ReferralStatus.sent) return;
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: {
          invitedUserId: payload.userId,
          status: ReferralStatus.signed_up,
          resolvedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(`referral signed_up update failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(NEST_EVENT.AdminTransferSettled)
  async onTransferSettled(payload: AdminTransferSettledPayload) {
    try {
      if (payload.direction !== 'deposit') return;
      const referral = await this.prisma.referral.findFirst({
        where: { invitedUserId: payload.userId, status: ReferralStatus.signed_up },
      });
      if (!referral) return;
      const isQualifyingKind = payload.kind === 'ach_in' || payload.kind === 'wire_in';
      if (!isQualifyingKind) return;
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: ReferralStatus.qualified,
          qualifiedAt: new Date(),
          payoutCents: this.bonusCents,
        },
      });
    } catch (err) {
      this.logger.warn(`referral qualified update failed: ${(err as Error).message}`);
    }
  }
}
