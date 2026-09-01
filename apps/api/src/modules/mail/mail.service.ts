import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import {
  STORAGE_DRIVER,
  StorageDriver,
} from '../documents/storage/storage.interface';
import { wrapPlainEmail } from '../../common/email/templates/plain-email';
import { sanitizeMailHtml, htmlToText } from './mail-sanitize';
import { deskFromHeader, getDeskIdentity } from './mail-desks';
import { MailDb, MailDesk, MailDirection } from './mail.types';
import { MAIL_NEST_EVENT, MailMessageCreatedPayload } from './mail.events';

/** Attachment staged in storage by the upload endpoint, passed back on send. */
export interface StagedAttachment {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface ComposeInput {
  adminId: string;
  desk: MailDesk;
  /** Existing customer id, when the recipient is a known user. */
  toUserId?: string | null;
  toEmail: string;
  toName?: string | null;
  subject: string;
  greeting?: string;
  /** Raw (unsanitized) admin HTML — sanitized here before send/store. */
  bodyHtml: string;
  signature?: string;
  attachments?: StagedAttachment[];
}

export interface ReplyInput {
  adminId: string;
  threadId: string;
  bodyHtml: string;
  signature?: string;
  attachments?: StagedAttachment[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly replyDomain: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {
    const key = config.get<string>('RESEND_API_KEY');
    this.resend = key ? new Resend(key) : null;
    this.replyDomain =
      config.get<string>('MAIL_REPLY_DOMAIN') ?? 'secure-access.site';
    this.webhookSecret = config.get<string>('RESEND_WEBHOOK_SECRET') ?? '';
  }

  private get db(): MailDb {
    return this.prisma as unknown as MailDb;
  }

  // ─── Compose / send ───────────────────────────────────────────────────

  async compose(input: ComposeInput) {
    const subject = input.subject.trim();
    if (!subject) throw new BadRequestException('Subject is required');
    const toEmail = input.toEmail.trim().toLowerCase();
    if (!toEmail) throw new BadRequestException('Recipient is required');

    const bodyHtml = sanitizeMailHtml(input.bodyHtml);
    const identity = getDeskIdentity(input.desk);
    const replyToken = this.generateToken();

    const thread = await this.db.mailThread.create({
      data: {
        userId: input.toUserId ?? null,
        toEmail,
        toName: input.toName ?? null,
        desk: input.desk,
        subject,
        replyToken,
        status: 'open',
        unreadForAdmins: false,
      },
    });

    const message = await this.deliver({
      thread,
      direction: 'outbound',
      desk: input.desk,
      fromEmail: identity.fromEmail,
      fromName: identity.fromName,
      toEmail,
      subject,
      greeting: input.greeting,
      bodyHtml,
      signature: input.signature,
      attachments: input.attachments,
      authoredByAdminId: input.adminId,
      // First message in the thread — no In-Reply-To.
      inReplyTo: null,
    });

    return { thread, message };
  }

  async reply(input: ReplyInput) {
    const thread = await this.db.mailThread.findUnique({
      where: { id: input.threadId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const bodyHtml = sanitizeMailHtml(input.bodyHtml);
    const identity = getDeskIdentity(thread.desk as MailDesk);

    // Thread the reply to the customer's most recent inbound message.
    const lastInbound = await this.db.mailMessage.findFirst({
      where: { threadId: thread.id, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { rfcMessageId: true },
    });

    const message = await this.deliver({
      thread,
      direction: 'outbound',
      desk: thread.desk as MailDesk,
      fromEmail: identity.fromEmail,
      fromName: identity.fromName,
      toEmail: thread.toEmail,
      subject: this.replySubject(thread.subject),
      bodyHtml,
      signature: input.signature,
      attachments: input.attachments,
      authoredByAdminId: input.adminId,
      inReplyTo: lastInbound?.rfcMessageId ?? null,
    });

    return { thread, message };
  }

  /** Shared outbound delivery: render, send via Resend, persist, emit. */
  private async deliver(args: {
    thread: any;
    direction: MailDirection;
    desk: MailDesk;
    fromEmail: string;
    fromName: string;
    toEmail: string;
    subject: string;
    greeting?: string;
    bodyHtml: string;
    signature?: string;
    attachments?: StagedAttachment[];
    authoredByAdminId: string;
    inReplyTo: string | null;
  }) {
    const html = wrapPlainEmail({
      title: args.subject,
      greeting: args.greeting,
      bodyHtml: args.bodyHtml,
      signature: args.signature,
    });
    const text = htmlToText(args.bodyHtml);

    // Pull staged attachment bytes out of storage to attach to the email.
    const staged = args.attachments ?? [];
    const emailAttachments = await Promise.all(
      staged.map(async (a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: await this.storage.get(a.storageKey),
      })),
    );

    // RFC threading headers so the customer's client keeps one conversation.
    const headers: Record<string, string> = {};
    if (args.inReplyTo) headers['In-Reply-To'] = args.inReplyTo;
    if (args.thread.references) headers['References'] = args.thread.references;

    // Admin-composed correspondence — explicit admin intent overrides the
    // notification kill switch.
    const { messageId } = await this.email.sendAndReturn({
      critical: true,
      to: args.toEmail,
      from: deskFromHeader(args.desk),
      replyTo: this.replyAddress(args.thread.replyToken),
      subject: args.subject,
      html,
      text,
      headers: Object.keys(headers).length ? headers : undefined,
      attachments: emailAttachments.length ? emailAttachments : undefined,
    });

    const message = await this.db.mailMessage.create({
      data: {
        threadId: args.thread.id,
        direction: args.direction,
        desk: args.desk,
        fromEmail: args.fromEmail,
        fromName: args.fromName,
        toEmail: args.toEmail,
        subject: args.subject,
        bodyHtml: args.bodyHtml,
        bodyText: text,
        providerMessageId: messageId || null,
        inReplyTo: args.inReplyTo,
        authoredByAdminId: args.authoredByAdminId,
        attachments: staged.length
          ? {
              create: staged.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                sizeBytes: a.sizeBytes,
                storageKey: a.storageKey,
              })),
            }
          : undefined,
      },
      include: { attachments: true },
    });

    await this.db.mailThread.update({
      where: { id: args.thread.id },
      data: { lastMessageAt: new Date(), unreadForAdmins: false },
    });

    this.emitCreated(args.thread.id, 'outbound', message.id);
    return message;
  }

  // ─── Listing / reading (admin) ────────────────────────────────────────

  async listThreads(filter: {
    desk?: MailDesk;
    status?: 'open' | 'closed';
    q?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (filter.desk) where.desk = filter.desk;
    if (filter.status) where.status = filter.status;
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      where.OR = [
        { toEmail: { contains: q, mode: 'insensitive' } },
        { toName: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
      ];
    }

    const threads = await this.db.mailThread.findMany({
      where,
      orderBy: [{ unreadForAdmins: 'desc' }, { lastMessageAt: 'desc' }],
      take: 200,
    });
    if (threads.length === 0) return [];

    // Last message body snippet per thread, one query.
    const lastMessages = await this.db.mailMessage.findMany({
      where: { threadId: { in: threads.map((t: any) => t.id) } },
      orderBy: { createdAt: 'desc' },
      distinct: ['threadId'],
      select: { threadId: true, bodyText: true, direction: true },
    });
    const snippet = new Map<string, { bodyText: string; direction: string }>();
    for (const m of lastMessages as any[]) {
      if (!snippet.has(m.threadId)) {
        snippet.set(m.threadId, { bodyText: m.bodyText, direction: m.direction });
      }
    }

    return threads.map((t: any) => ({
      ...t,
      lastSnippet: snippet.get(t.id)?.bodyText?.slice(0, 140) ?? null,
      lastDirection: snippet.get(t.id)?.direction ?? null,
    }));
  }

  async getThread(threadId: string) {
    const thread = await this.db.mailThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  async getMessages(threadId: string) {
    const thread = await this.db.mailThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    // Opening the thread clears the unread flag (mirror support).
    if (thread.unreadForAdmins) {
      await this.db.mailThread.update({
        where: { id: threadId },
        data: { unreadForAdmins: false },
      });
      this.events.emit('admin.queue.changed', { mailUnreadDelta: -1 });
    }

    return this.db.mailMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });
  }

  async closeThread(threadId: string) {
    return this.db.mailThread.update({
      where: { id: threadId },
      data: { status: 'closed' },
    });
  }

  async reopenThread(threadId: string) {
    return this.db.mailThread.update({
      where: { id: threadId },
      data: { status: 'open' },
    });
  }

  // ─── Attachments ──────────────────────────────────────────────────────

  /** Stage an uploaded file in storage; returns metadata to echo back on send. */
  async stageAttachment(file: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }): Promise<StagedAttachment> {
    const key = `mail/outbound/${randomBytes(16).toString('hex')}/${sanitizeFilename(file.originalname)}`;
    await this.storage.put({
      key,
      body: file.buffer,
      contentType: file.mimetype || 'application/octet-stream',
    });
    return {
      storageKey: key,
      filename: file.originalname,
      contentType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
    };
  }

  /** Fetch a persisted attachment's bytes + metadata for download/streaming. */
  async getAttachmentForDownload(id: string): Promise<{
    filename: string;
    contentType: string;
    bytes: Buffer;
  }> {
    const att = await this.db.mailAttachment.findUnique({ where: { id } });
    if (!att || !att.storageKey) {
      throw new NotFoundException('Attachment not found');
    }
    return {
      filename: att.filename,
      contentType: att.contentType,
      bytes: await this.storage.get(att.storageKey),
    };
  }

  // ─── Inbound (Resend email.received webhook) ──────────────────────────

  /**
   * Verify a raw Resend webhook payload and return the typed event, or null
   * if verification fails / it isn't an inbound email we handle.
   */
  verifyWebhook(
    rawPayload: string,
    headers: { id: string; timestamp: string; signature: string },
  ): any | null {
    if (!this.resend) {
      this.logger.warn('Resend not configured; cannot verify webhook.');
      return null;
    }
    if (!this.webhookSecret) {
      this.logger.warn('RESEND_WEBHOOK_SECRET not set; rejecting webhook.');
      return null;
    }
    try {
      const event = this.resend.webhooks.verify({
        payload: rawPayload,
        headers,
        webhookSecret: this.webhookSecret,
      });
      this.logger.log(`Webhook verified OK (type=${(event as any)?.type}).`);
      return event;
    } catch (err) {
      this.logger.warn(`Webhook signature verify failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Handle a verified `email.received` event. The webhook carries metadata
   * only, so we fetch the full body + attachment bytes from the Resend
   * receiving API, resolve the owning thread, and persist an inbound message.
   */
  async handleInbound(data: {
    email_id: string;
    from: string;
    to: string[];
    cc?: string[];
    subject: string;
    message_id: string;
    attachments?: Array<{ id: string; filename?: string; content_type?: string; size?: number }>;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn('handleInbound: Resend not configured (no RESEND_API_KEY).');
      return;
    }

    this.logger.log(
      `handleInbound: email_id=${data.email_id} from=${data.from} ` +
        `to=[${(data.to ?? []).join(', ')}] replyDomain=${this.replyDomain}`,
    );

    // 1. Resolve the thread: prefer the reply-token address, fall back to the
    //    References/In-Reply-To chain once we have the full headers.
    let thread = await this.resolveThreadByToken(data.to, data.cc);
    if (thread) {
      this.logger.log(`handleInbound: matched thread ${thread.id} by reply token.`);
    }

    // 2. Pull the full received email (body, headers).
    const full = await this.resend.emails.receiving.get(data.email_id);
    const received = (full as any)?.data;
    if (!received) {
      this.logger.warn(`Could not fetch received email ${data.email_id}`);
      return;
    }

    if (!thread) {
      thread = await this.resolveThreadByReferences(received.headers);
    }
    if (!thread) {
      this.logger.warn(
        `Inbound email ${data.email_id} did not match any thread (to=${data.to.join(',')})`,
      );
      return;
    }

    const bodyHtml = sanitizeMailHtml(received.html ?? '');
    const bodyText: string =
      received.text ?? (bodyHtml ? htmlToText(bodyHtml) : '');

    // 3. Append the customer message-id to the thread References chain.
    const references = [thread.references, received.message_id]
      .filter(Boolean)
      .join(' ');

    const message = await this.db.mailMessage.create({
      data: {
        threadId: thread.id,
        direction: 'inbound',
        desk: thread.desk,
        fromEmail: extractEmail(data.from),
        fromName: extractName(data.from),
        toEmail: thread.toEmail,
        subject: data.subject || thread.subject,
        bodyHtml: bodyHtml || `<p>${escapeText(bodyText)}</p>`,
        bodyText,
        providerMessageId: data.email_id,
        rfcMessageId: received.message_id ?? data.message_id,
      },
    });

    // 4. Download + persist attachments (best-effort).
    if (data.attachments?.length) {
      await this.persistInboundAttachments(
        data.email_id,
        message.id,
        data.attachments,
      );
    }

    await this.db.mailThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt: new Date(),
        unreadForAdmins: true,
        status: 'open',
        references: references || null,
      },
    });

    this.emitCreated(thread.id, 'inbound', message.id);
    this.events.emit('admin.queue.changed', { mailUnreadDelta: 1 });
  }

  private async persistInboundAttachments(
    emailId: string,
    messageId: string,
    attachments: Array<{ id: string; filename?: string; content_type?: string; size?: number }>,
  ): Promise<void> {
    for (const a of attachments) {
      try {
        const meta = await this.resend!.emails.receiving.attachments.get({
          emailId,
          id: a.id,
        });
        const url = (meta as any)?.data?.download_url;
        if (!url) continue;
        const res = await fetch(url);
        const bytes = Buffer.from(await res.arrayBuffer());
        const filename = a.filename ?? meta.data?.filename ?? 'attachment';
        const key = `mail/inbound/${emailId}/${a.id}/${sanitizeFilename(filename)}`;
        await this.storage.put({
          key,
          body: bytes,
          contentType: a.content_type ?? 'application/octet-stream',
        });
        await this.db.mailAttachment.create({
          data: {
            messageId,
            filename,
            contentType: a.content_type ?? 'application/octet-stream',
            sizeBytes: a.size ?? bytes.length,
            storageKey: key,
            resendAttachmentId: a.id,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to persist inbound attachment ${a.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async resolveThreadByToken(
    to: string[],
    cc?: string[],
  ): Promise<any | null> {
    const addresses = [...(to ?? []), ...(cc ?? [])];
    for (const addr of addresses) {
      const token = this.parseToken(addr);
      if (!token) continue;
      const thread = await this.db.mailThread.findUnique({
        where: { replyToken: token },
      });
      if (thread) return thread;
    }
    return null;
  }

  private async resolveThreadByReferences(
    headers: Record<string, string> | null,
  ): Promise<any | null> {
    if (!headers) return null;
    const refRaw =
      headers['in-reply-to'] ??
      headers['In-Reply-To'] ??
      headers['references'] ??
      headers['References'];
    if (!refRaw) return null;
    const ids = refRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return null;
    const msg = await this.db.mailMessage.findFirst({
      where: { rfcMessageId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { threadId: true },
    });
    if (!msg) return null;
    return this.db.mailThread.findUnique({ where: { id: msg.threadId } });
  }

  /** Extract the thread token from a `t-<token>@<replyDomain>` address. */
  private parseToken(address: string): string | null {
    const email = extractEmail(address).toLowerCase();
    const re = new RegExp(
      `^t-([a-z0-9]+)@${this.replyDomain.replace(/[.]/g, '\\.')}$`,
      'i',
    );
    const m = email.match(re);
    return m ? m[1] : null;
  }

  private replyAddress(token: string): string {
    return `t-${token}@${this.replyDomain}`;
  }

  private generateToken(): string {
    return randomBytes(12).toString('hex');
  }

  private replySubject(subject: string): string {
    return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  }

  private emitCreated(threadId: string, direction: MailDirection, messageId: string): void {
    this.events.emit(MAIL_NEST_EVENT.MessageCreated, {
      threadId,
      direction,
      messageId,
      at: new Date().toISOString(),
    } satisfies MailMessageCreatedPayload);
  }
}

// ─── module-local helpers ───────────────────────────────────────────────

function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}

function extractName(addr: string): string | null {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

function escapeText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
