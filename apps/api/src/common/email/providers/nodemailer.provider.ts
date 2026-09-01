import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { lookup as dnsLookup } from 'dns';
import { promisify } from 'util';
import { EmailProvider, TransactionalEmailInput } from './email.provider.interface';

const dnsLookupAsync = promisify(dnsLookup);

/**
 * Sole email provider for the backend. Wraps a single nodemailer SMTP
 * transport configured from env vars:
 *
 *   SMTP_HOST   — required for outbound delivery; if unset, sending is
 *                 disabled and every call no-ops with a warning. Local
 *                 dev can point at mailhog (localhost:1025).
 *   SMTP_PORT   — defaults to 587 (STARTTLS). Use 465 for implicit TLS.
 *   SMTP_USER / SMTP_PASS — credentials. Omit both for hosts that don't
 *                 require auth (mailhog, internal relays).
 *   SMTP_FROM   — From: header. Defaults to 'no-reply@cbb.gov.bh'.
 *   SMTP_SECURE — explicit override for `secure: true|false`. Inferred
 *                 from port when unset (465 → secure, others → not).
 */
@Injectable()
export class NodemailerEmailProvider implements EmailProvider {
  private readonly logger = new Logger(NodemailerEmailProvider.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly readyPromise: Promise<void>;

  constructor(config: ConfigService) {
    this.from = config.get<string>('SMTP_FROM') ?? 'no-reply@cbb.gov.bh';
    const host = config.get<string>('SMTP_HOST');
    const port = Number(config.get<string>('SMTP_PORT') ?? 587);
    const user = config.get<string>('SMTP_USER') ?? '';
    const pass = config.get<string>('SMTP_PASS') ?? '';
    const secureEnv = config.get<string>('SMTP_SECURE');

    if (!host) {
      this.logger.warn(
        'SMTP_HOST is not set, email sending is disabled. Set SMTP_HOST/PORT/USER/PASS to enable.',
      );
      this.readyPromise = Promise.resolve();
      return;
    }

    const secure =
      secureEnv != null
        ? secureEnv.toLowerCase() === 'true'
        : port === 465;
    const requireTLS = !secure && port === 587;
    const isLocalDev = host === 'localhost' || host === '127.0.0.1';

    // Pre-resolve the SMTP host via the OS resolver (getaddrinfo). On
    // networks where c-ares can't reach its inherited DNS servers
    // (link-local fe80::1, blocked outbound :53), nodemailer's internal
    // dns.resolve4 hangs and every email fails with queryA ETIMEOUT.
    // Feeding it the IP up-front plus `tls.servername` keeps SNI/cert
    // validation intact while skipping the broken c-ares path entirely.
    this.readyPromise = (async () => {
      let connectHost = host;
      if (!isLocalDev && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        try {
          const { address } = await dnsLookupAsync(host, { family: 4 });
          connectHost = address;
          this.logger.log(`Resolved SMTP host ${host} → ${address} (IPv4)`);
        } catch (err) {
          this.logger.warn(
            `Could not pre-resolve ${host}: ${(err as Error).message}. ` +
              `Falling back to nodemailer's built-in resolver.`,
          );
        }
      }
      this.transporter = nodemailer.createTransport({
        host: connectHost,
        port,
        secure,
        requireTLS,
        ignoreTLS: isLocalDev && !secure && !requireTLS,
        auth: user ? { user, pass } : undefined,
        // Fail fast instead of hanging the request path for 60s when SMTP
        // is unreachable (firewalled tunnel, Gmail throttling, offline).
        connectionTimeout: 8_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
        // When we connected by IP, SNI + cert validation still need the
        // real hostname so Gmail's cert verifies.
        tls: connectHost !== host ? { servername: host } : undefined,
      });
      this.logger.log(
        `Nodemailer SMTP transport ready (host=${host}, port=${port}, secure=${secure})`,
      );
    })();
  }

  async send(input: TransactionalEmailInput): Promise<{ messageId: string }> {
    // Wait for the startup DNS pre-resolve to finish before the first send.
    // Subsequent calls resolve instantly since the promise is already settled.
    await this.readyPromise;
    if (!this.transporter) {
      this.logger.warn(
        `Skipped email "${input.subject}"SMTP not configured.`,
      );
      return { messageId: '' };
    }
    const result = await this.transporter.sendMail({
      from: input.from ?? this.from,
      to: Array.isArray(input.to) ? input.to.join(',') : input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      headers: input.headers,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.bytes,
        contentType: a.contentType,
      })),
    });
    return { messageId: result.messageId ?? '' };
  }
}
