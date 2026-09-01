import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  KycStatus,
  Prisma,
  SignupSession,
  SignupStage,
  VerificationChannel,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Argon2Service } from '../../crypto/argon2.service';
import { AesGcmService } from '../../crypto/aes-gcm.service';
import { HmacService } from '../../crypto/hmac.service';
import { DocumentsService } from '../../documents/documents.service';

export const SIGNUP_COMPLETED_EVENT = 'user.signed_up';

export interface SignupCompletedPayload {
  userId: string;
  signupId: string;
  ip: string;
  at: Date;
}

const STAGE_ORDER: SignupStage[] = [
  SignupStage.started,
  SignupStage.contact_collected,
  SignupStage.channel_chosen,
  SignupStage.verified,
  SignupStage.dob_collected,
  SignupStage.card_chosen,
  SignupStage.address_collected,
  SignupStage.password_set,
  SignupStage.details_collected,
  SignupStage.ssn_collected,
  SignupStage.docs_submitted,
  SignupStage.completed,
];

function requireStageAtLeast(actual: SignupStage, required: SignupStage): void {
  if (STAGE_ORDER.indexOf(actual) < STAGE_ORDER.indexOf(required)) {
    throw new BadRequestException(`Step requires stage >= ${required}, current ${actual}`);
  }
}

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);
  private readonly sessionTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: Argon2Service,
    private readonly aes: AesGcmService,
    private readonly hmac: HmacService,
    private readonly documents: DocumentsService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.sessionTtlDays = Number(config.get('SIGNUP_SESSION_TTL_DAYS') ?? 7);
  }

  async load(id: string): Promise<SignupSession> {
    const s = await this.prisma.signupSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Signup session not found');
    if (s.expiresAt < new Date()) throw new BadRequestException('Signup session expired');
    if (s.stage === SignupStage.completed) throw new BadRequestException('Signup already completed');
    return s;
  }

  async begin(input: { firstName: string; lastName: string; email: string; phoneE164: string; referralCode?: string }): Promise<SignupSession> {
    const existingUser = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) throw new ConflictException('Email already registered');
    // Catch a duplicate phone up-front so the user isn't walked all the way
    // through the funnel only to fail at `complete()` on the unique index.
    if (input.phoneE164) {
      const phoneTaken = await this.prisma.user.findFirst({
        where: { phoneE164: input.phoneE164 },
        select: { id: true },
      });
      if (phoneTaken) {
        throw new ConflictException(
          'That phone number is already linked to a State Bank account.',
        );
      }
    }
    const existingSession = await this.prisma.signupSession.findUnique({ where: { email: input.email } });
    if (existingSession) {
      const stale =
        existingSession.stage === SignupStage.completed ||
        existingSession.expiresAt <= new Date();
      if (stale) {
        // Stale row blocks a fresh start because (email) is unique on
        // SignupSession. Drop it so the create below succeeds — the user
        // can retry the funnel with the same email.
        //
        // Verification has FK with RESTRICT on signupSessionId, so we
        // wipe child rows first inside a single transaction. Same for
        // any documents the stale signup uploaded.
        await this.prisma.$transaction([
          this.prisma.verification.deleteMany({
            where: { signupSessionId: existingSession.id },
          }),
          this.prisma.document.deleteMany({
            where: { ownerSignupId: existingSession.id },
          }),
          this.prisma.signupSession.delete({
            where: { id: existingSession.id },
          }),
        ]);
      } else {
        return this.prisma.signupSession.update({
          where: { id: existingSession.id },
          data: {
            firstName: input.firstName,
            lastName: input.lastName,
            phoneE164: input.phoneE164,
            referralCode: input.referralCode ?? existingSession.referralCode ?? undefined,
            stage: SignupStage.contact_collected,
          },
        });
      }
    }
    const expiresAt = new Date(Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1000);
    return this.prisma.signupSession.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phoneE164: input.phoneE164,
        referralCode: input.referralCode ?? null,
        stage: SignupStage.contact_collected,
        expiresAt,
      },
    });
  }

  async markChannelChosen(session: SignupSession): Promise<void> {
    requireStageAtLeast(session.stage, SignupStage.contact_collected);
    if (STAGE_ORDER.indexOf(session.stage) < STAGE_ORDER.indexOf(SignupStage.channel_chosen)) {
      await this.prisma.signupSession.update({
        where: { id: session.id },
        data: { stage: SignupStage.channel_chosen },
      });
    }
  }

  async markVerified(session: SignupSession, channel: VerificationChannel): Promise<void> {
    requireStageAtLeast(session.stage, SignupStage.contact_collected);
    await this.prisma.signupSession.update({
      where: { id: session.id },
      data: {
        stage: SignupStage.verified,
        verifiedChannel: channel,
        verifiedAt: new Date(),
      },
    });
  }

  async setDob(session: SignupSession, dobIso: string) {
    requireStageAtLeast(session.stage, SignupStage.verified);
    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: { dob: new Date(dobIso), stage: SignupStage.dob_collected },
    });
  }

  async setCard(session: SignupSession, cardChoice: string) {
    requireStageAtLeast(session.stage, SignupStage.dob_collected);
    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: { cardChoice, stage: SignupStage.card_chosen },
    });
  }

  async setAddress(session: SignupSession, addr: { street: string; apt?: string; city: string; state: string; zip: string }) {
    // Card-choice step has been removed from the signup UI — Address now
    // follows DOB directly. Backfill a default cardChoice if missing so
    // existing downstream code that reads it doesn't NPE.
    requireStageAtLeast(session.stage, SignupStage.dob_collected);
    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: {
        ...addr,
        cardChoice: session.cardChoice ?? 'checking',
        stage: SignupStage.address_collected,
      },
    });
  }

  async setPassword(session: SignupSession, password: string) {
    requireStageAtLeast(session.stage, SignupStage.address_collected);
    const passwordHash = await this.argon.hash(password);
    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: { passwordHash, stage: SignupStage.password_set },
    });
  }

  async setDetails(session: SignupSession, d: {
    income?: string; occupation?: string; annualIncome?: string;
    payMethod?: string; foundUs?: string; marketingConsent?: boolean;
  }) {
    requireStageAtLeast(session.stage, SignupStage.password_set);
    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: { ...d, stage: SignupStage.details_collected },
    });
  }

  /**
   * Persist the customer's national ID. Field repurposed from US SSN to
   * Passport ID (6–9 uppercase alphanumeric per ICAO 9303). DB column
   * names left as ssnHash/ssnEncrypted for backwards-compat — the
   * stored value is now the passport number.
   */
  async setSsn(session: SignupSession, ssnPlain: string) {
    requireStageAtLeast(session.stage, SignupStage.details_collected);
    const normalized = ssnPlain.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{6,9}$/.test(normalized)) {
      throw new BadRequestException(
        'Passport ID must be 6–9 uppercase letters/digits',
      );
    }

    const ssnHash = this.hmac.ssnHash(normalized);
    const dup = await this.prisma.signupSession.findFirst({
      where: { ssnHash, id: { not: session.id } },
    });
    if (dup) throw new ConflictException('Passport ID already in use');

    const ssnEncryptedB64 = this.aes.encrypt(normalized);
    const ssnEncrypted = Buffer.from(ssnEncryptedB64, 'base64');
    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: { ssnEncrypted, ssnHash, stage: SignupStage.ssn_collected },
    });
  }

  async markDocsSubmitted(session: SignupSession): Promise<SignupSession> {
    requireStageAtLeast(session.stage, SignupStage.ssn_collected);
    const docs = await this.prisma.document.findMany({ where: { ownerSignupId: session.id } });
    const required = ['id_front', 'id_back'];
    const missing = required.filter((t) => !docs.some((d) => d.type === t));
    if (missing.length) throw new BadRequestException(`Missing documents: ${missing.join(', ')}`);

    return this.prisma.signupSession.update({
      where: { id: session.id },
      data: { stage: SignupStage.docs_submitted },
    });
  }

  async complete(session: SignupSession, ip: string): Promise<{ userId: string }> {
    if (session.stage !== SignupStage.docs_submitted) {
      throw new BadRequestException(`Cannot complete from stage ${session.stage}`);
    }
    if (!session.email || !session.passwordHash || !session.firstName || !session.lastName) {
      throw new BadRequestException('Missing required signup fields');
    }

    // Pre-flight uniqueness checks so the user gets a clean 409 instead of
    // a 500 from the unique-constraint violation inside the transaction.
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: session.email },
      select: { id: true },
    });
    if (emailTaken) {
      throw new ConflictException('Email already registered');
    }
    if (session.phoneE164) {
      const phoneTaken = await this.prisma.user.findFirst({
        where: { phoneE164: session.phoneE164 },
        select: { id: true },
      });
      if (phoneTaken) {
        throw new ConflictException(
          'That phone number is already linked to a State Bank account.',
        );
      }
    }

    let result: { userId: string };
    try {
      result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: session.email!,
          passwordHash: session.passwordHash!,
          phoneE164: session.phoneE164,
          firstName: session.firstName,
          lastName: session.lastName,
          dob: session.dob,
        },
      });
      await tx.kycRecord.create({
        data: {
          userId: user.id,
          status: KycStatus.pending,
          missingFields: [],
        },
      });
      await tx.document.updateMany({
        where: { ownerSignupId: session.id },
        data: { ownerSignupId: null, ownerUserId: user.id },
      });
      await tx.signupSession.update({
        where: { id: session.id },
        data: { stage: SignupStage.completed, resolvedUserId: user.id },
      });
      return { userId: user.id };
      });
    } catch (err) {
      // A concurrent signup could still win the race between our pre-flight
      // check and the create. Translate the unique-constraint violation
      // into a friendly 409 instead of leaking a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | string | undefined) ?? '';
        const field = Array.isArray(target) ? target.join(',') : String(target);
        if (field.includes('phoneE164')) {
          throw new ConflictException(
            'That phone number is already linked to a State Bank account.',
          );
        }
        if (field.includes('email')) {
          throw new ConflictException('Email already registered');
        }
        throw new ConflictException('Some of your details are already in use.');
      }
      throw err;
    }

    this.events.emit(SIGNUP_COMPLETED_EVENT, {
      userId: result.userId,
      signupId: session.id,
      ip,
      at: new Date(),
    } as SignupCompletedPayload);

    return result;
  }
}
