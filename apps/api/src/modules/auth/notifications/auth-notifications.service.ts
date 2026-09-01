import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../../../common/email/email.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NEST_EVENT, NestSessionCreatedPayload } from '../../realtime/events';
import { buildSigninAlertEmail } from './templates/signin-alert.email';
import { buildAdminUserSigninEmail } from './templates/admin-user-signin.email';
import { buildWelcomeUserEmail } from './templates/welcome-user.email';
import { SIGNUP_COMPLETED_EVENT, SignupCompletedPayload } from '../signup/signup.service';

@Injectable()
export class AuthNotificationsService {
  private readonly logger = new Logger(AuthNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(NEST_EVENT.SessionCreated)
  async onSessionCreated(payload: NestSessionCreatedPayload) {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sessionId },
        include: { device: true, user: true },
      });
      if (!session) return;

      const loc = (session.device.locationLastSeen ?? {}) as { city?: string; region?: string; country?: string };

      const userEmail = buildSigninAlertEmail({
        deviceName: session.device.name,
        os: session.device.os,
        browser: session.device.browser,
        ip: session.device.ipLastSeen,
        city: loc.city,
        region: loc.region,
        country: loc.country,
        at: payload.at,
        firstName: session.user.firstName,
        webBaseUrl: this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000',
      });
      await this.email.send({
        to: session.user.email,
        subject: userEmail.subject,
        text: userEmail.text,
        html: userEmail.html,
      });

      const enabled = this.config.get<boolean>('ADMIN_NOTIFICATION_ENABLED');
      if (enabled) {
        const admins = (this.config.get<string>('ADMIN_NOTIFICATION_EMAIL') ?? '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        if (admins.length) {
          const adminEmail = buildAdminUserSigninEmail({
            userEmail: session.user.email,
            novaTag: session.user.novaTag,
            deviceName: session.device.name,
            os: session.device.os,
            browser: session.device.browser,
            ip: session.device.ipLastSeen,
            city: loc.city,
            region: loc.region,
            country: loc.country,
            at: payload.at,
          });
          await this.email.send({ to: admins, subject: adminEmail.subject, text: adminEmail.text });
        }
      }
    } catch (err) {
      this.logger.warn(`auth-notifications dispatch failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(SIGNUP_COMPLETED_EVENT)
  async onSignupCompleted(payload: SignupCompletedPayload) {
    if (!this.config.get<boolean>('WELCOME_EMAIL_ENABLED')) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return;
      const tpl = buildWelcomeUserEmail({
        firstName: user.firstName,
        webBaseUrl: this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000',
        applicationRef: `State Bank-${payload.signupId.slice(0, 8).toUpperCase()}`,
        submittedAt: payload.at,
      });
      await this.email.send({
        to: user.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } catch (err) {
      this.logger.warn(`welcome email dispatch failed: ${(err as Error).message}`);
    }
  }
}
