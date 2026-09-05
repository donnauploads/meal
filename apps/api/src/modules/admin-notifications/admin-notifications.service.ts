import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService, EmailAttachment } from '../../common/email/email.service';
import { GeoipService } from '../../common/geoip/geoip.service';
import { DocumentsService } from '../documents/documents.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { SIGNUP_COMPLETED_EVENT, SignupCompletedPayload } from '../auth/signup/signup.service';
import { NEST_EVENT, AdminTransferSettledPayload } from '../realtime/events';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { buildAdminUserSignupEmail } from './templates/admin-user-signup.email';
import { buildAdminDepositEmail } from './templates/admin-deposit.email';
import { buildAdminWithdrawalEmail } from './templates/admin-withdrawal.email';

@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly geoip: GeoipService,
    private readonly documents: DocumentsService,
    private readonly aes: AesGcmService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(SIGNUP_COMPLETED_EVENT)
  async onSignupCompleted(payload: SignupCompletedPayload) {
    try {
      const enabled = this.config.get<boolean>('ADMIN_NOTIFICATION_ENABLED');
      if (!enabled) return;

      const recipients = (this.config.get<string>('ADMIN_KYC_REVIEW_EMAIL') ?? this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (!recipients.length) return;

      const [user, signup, docs] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: payload.userId } }),
        this.prisma.signupSession.findUnique({ where: { id: payload.signupId } }),
        this.prisma.document.findMany({ where: { ownerUserId: payload.userId } }),
      ]);
      if (!user || !signup) return;

      let ssnLast4 = '-';
      if (signup.ssnEncrypted) {
        try {
          const plain = this.aes.decrypt(Buffer.from(signup.ssnEncrypted).toString('base64'));
          ssnLast4 = plain.slice(-4);
        } catch {
          ssnLast4 = '-';
        }
      }

      const geo = await this.geoip.resolve(payload.ip);
      const tpl = buildAdminUserSignupEmail({
        userEmail: user.email,
        phoneE164: user.phoneE164,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(' '),
        dob: user.dob,
        address: {
          street: signup.street, apt: signup.apt, city: signup.city, state: signup.state, zip: signup.zip,
        },
        ssnLast4,
        verifiedChannel: signup.verifiedChannel,
        ip: payload.ip,
        city: geo.city, region: geo.region, country: geo.country,
        at: payload.at,
      });

      const maxBytes = Number(this.config.get('ADMIN_ATTACHMENT_MAX_BYTES') ?? 20 * 1024 * 1024);
      const attachments: EmailAttachment[] = [];
      let total = 0;
      for (const doc of docs) {
        if (total + doc.sizeBytes > maxBytes) {
          this.logger.warn(`Skipping attachment ${doc.id}: combined size would exceed ${maxBytes}`);
          continue;
        }
        try {
          const buf = await this.documents.fetchBytes(doc.storageKey);
          attachments.push({
            filename: `${doc.type}.${extensionFromMime(doc.contentType)}`,
            content: buf,
            contentType: doc.contentType,
          });
          total += doc.sizeBytes;
        } catch (err) {
          this.logger.warn(`Could not fetch ${doc.storageKey}: ${(err as Error).message}`);
        }
      }

      await this.email.send({
        to: recipients,
        subject: tpl.subject,
        text: tpl.text,
        attachments,
      });
    } catch (err) {
      this.logger.error(`admin-notifications.signup failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(NEST_EVENT.AdminTransferSettled)
  async onTransferSettled(payload: AdminTransferSettledPayload) {
    try {
      if (!this.config.get<boolean>('ADMIN_NOTIFICATION_ENABLED')) return;

      const minCents = BigInt(this.config.get<string>('ADMIN_NOTIFY_TRANSFER_MIN_CENTS') ?? '0');
      if (payload.amountCents < minCents) return;

      const burstKey = `admin-notify:transfer:${payload.userId}:${payload.direction}`;
      const recent = await this.cache.get<number>(burstKey);
      if (recent) {
        this.logger.debug(`Skipping admin ${payload.direction} email for ${payload.userId} — within burst window`);
        return;
      }
      const windowSec = Number(this.config.get('ADMIN_NOTIFY_TRANSFER_BURST_WINDOW_SEC') ?? 60);
      await this.cache.set(burstKey, 1, windowSec);

      const recipients = (this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (!recipients.length) return;

      const account = await this.prisma.account.findFirst({ where: { userId: payload.userId } });
      const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return;

      const builder = payload.direction === 'deposit' ? buildAdminDepositEmail : buildAdminWithdrawalEmail;
      const tpl = builder({
        userEmail: user.email,
        amountMinor: Number(payload.amountCents),
        currency: 'USD',
        accountId: account?.id ?? '-',
        at: payload.settledAt,
      });
      await this.email.send({ to: recipients, subject: tpl.subject, text: tpl.text });
    } catch (err) {
      this.logger.warn(`admin transfer notification failed: ${(err as Error).message}`);
    }
  }
}

function extensionFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  return 'jpg';
}
