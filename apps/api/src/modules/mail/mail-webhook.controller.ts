import {
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MailService } from './mail.service';

/**
 * Public endpoint Resend calls for inbound email events. Configured in the
 * Resend dashboard as the `email.received` webhook target:
 *
 *   https://<api-host>/api/v1/webhooks/resend/inbound
 *
 * The route receives the RAW request body (set up in main.ts via
 * `express.raw` for this path) so the Svix signature can be verified before
 * we trust anything in the payload.
 */
@Public()
@Controller('webhooks/resend')
export class MailWebhookController {
  private readonly logger = new Logger(MailWebhookController.name);

  constructor(private readonly mail: MailService) {}

  @Post('inbound')
  @HttpCode(200)
  async inbound(@Req() req: Request) {
    // express.raw leaves req.body as a Buffer for this route.
    const isRaw = Buffer.isBuffer(req.body);
    this.logger.log(
      `Inbound webhook hit (bodyIsRaw=${isRaw}, ` +
        `hasSvixSig=${!!(req.headers['svix-signature'] || req.headers['webhook-signature'])})`,
    );
    if (!isRaw) {
      this.logger.warn(
        'Webhook body is NOT a raw Buffer — signature verification will fail. ' +
          'Ensure bodyParser:false is set in main.ts and the raw middleware ' +
          'is registered for /api/v1/webhooks/resend/inbound.',
      );
    }
    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});

    // Resend signs with Svix headers (svix-id / -timestamp / -signature).
    // Some setups deliver the Standard Webhooks `webhook-*` aliases — accept
    // either so verification works regardless.
    const h = (name: string): string => {
      const v = req.headers[name];
      return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
    };
    const headers = {
      id: h('svix-id') || h('webhook-id'),
      timestamp: h('svix-timestamp') || h('webhook-timestamp'),
      signature: h('svix-signature') || h('webhook-signature'),
    };

    const event = this.mail.verifyWebhook(raw, headers);
    if (!event) {
      // Verification failed or not configured. 200 so Resend doesn't retry
      // a request we will never accept; the failure is already logged.
      return { ok: false };
    }

    if (event.type === 'email.received') {
      try {
        await this.mail.handleInbound(event.data);
      } catch (err) {
        this.logger.error(
          `handleInbound failed: ${(err as Error).message}`,
          (err as Error).stack,
        );
        // 200 anyway — Resend stores the email; retries rarely help a code
        // bug, and we don't want a poison event hammering the endpoint.
      }
    }
    return { ok: true };
  }
}
