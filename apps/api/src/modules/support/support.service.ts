import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import {
  SupportMessage,
  SupportSenderRole,
  SupportThread,
  SupportThreadStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

// Until the Prisma client is regenerated post-migration (the engine
// file is locked while the dev server runs), the generated PrismaService
// type doesn't yet expose the support tables. This helper casts through
// for the chained calls — once the dev server is stopped and
// `prisma generate` runs, you can delete this and use `this.prisma`
// directly.
type WithSupport = {
  supportThread: any
  supportMessage: any
}
import { EmailService } from '../../common/email/email.service';
import {
  SUPPORT_NEST_EVENT,
  SupportMessageCreatedPayload,
  SupportMessagesReadPayload,
  SupportThreadClosedPayload,
} from './support.events';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly adminEmail: string;
  private readonly fromAddress: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.adminEmail =
      config.get<string>('SUPPORT_ADMIN_EMAIL') ?? 'support@cbb.gov.bh';
    this.fromAddress =
      config.get<string>('EMAIL_FROM') ?? 'noreply@cbb.gov.bh';
  }

  // ─── Customer-side ────────────────────────────────────────────────────

  /** Reuse the most recent open thread when one exists; otherwise create
   *  a new one. The customer UX is "one rolling conversation" — they
   *  don't manage tickets. */
  async openOrGetCustomerThread(userId: string): Promise<SupportThread> {
    const existing = await (this.prisma as unknown as WithSupport).supportThread.findFirst({
      where: { userId, status: SupportThreadStatus.open },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (existing) return existing;
    return (this.prisma as unknown as WithSupport).supportThread.create({
      data: { userId, status: SupportThreadStatus.open },
    });
  }

  async listCustomerMessages(
    userId: string,
    threadId: string,
  ): Promise<SupportMessage[]> {
    const thread = await (this.prisma as unknown as WithSupport).supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    if (thread.userId !== userId) throw new ForbiddenException('Not your thread');
    return (this.prisma as unknown as WithSupport).supportMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async postCustomerMessage(
    userId: string,
    threadId: string,
    body: string,
  ): Promise<SupportMessage> {
    const trimmed = body.trim();
    if (!trimmed) throw new ForbiddenException('Empty message');
    const thread = await (this.prisma as unknown as WithSupport).supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread || thread.userId !== userId) {
      throw new NotFoundException('Thread not found');
    }
    if (thread.status === SupportThreadStatus.closed) {
      // The customer's modal should call /support/thread to spin up a
      // fresh thread before retrying. Surface a stable error code so the
      // FE can handle this without parsing a message.
      throw new ForbiddenException('THREAD_CLOSED');
    }
    const isFirstMessage = (await (this.prisma as unknown as WithSupport).supportMessage.count({
      where: { threadId },
    })) === 0;

    const [message] = await this.prisma.$transaction([
      (this.prisma as unknown as WithSupport).supportMessage.create({
        data: {
          threadId,
          senderId: userId,
          senderRole: SupportSenderRole.customer,
          body: trimmed,
        },
      }),
      (this.prisma as unknown as WithSupport).supportThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          unreadForAdmins: true,
          status: SupportThreadStatus.open,
        },
      }),
    ]);

    this.emitMessageCreated(thread, message);

    // First message → notify support team by email. Best-effort; the
    // EmailService swallows provider errors.
    if (isFirstMessage) {
      void this.notifyAdminsByEmail(thread, trimmed, userId);
    }
    return message;
  }

  // ─── Admin-side ──────────────────────────────────────────────────────

  async listAdminThreads(): Promise<
    Array<
      SupportThread & {
        customerName: string | null
        customerEmail: string
        lastBody: string | null
        lastIp: string | null
        lastGeo: {
          city: string | null
          region: string | null
          country: string | null
          countryCode: string | null
        } | null
      }
    >
  > {
    const threads: SupportThread[] = await (
      this.prisma as unknown as WithSupport
    ).supportThread.findMany({
      orderBy: [{ unreadForAdmins: 'desc' }, { lastMessageAt: 'desc' }],
      take: 200,
    });
    if (threads.length === 0) return [];

    // Guest threads have no userId — only look up real users.
    const userIds = [
      ...new Set(
        threads
          .map((t: SupportThread) => t.userId as string | null)
          .filter((id): id is string => !!id),
      ),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u] as const));

    // Pull the most-recent active device per customer so the admin chat
    // header can show their last-seen IP + location/flag. One findMany +
    // an in-memory "first occurrence wins" since we already ordered by
    // lastSeenAt desc.
    const devices = await this.prisma.device.findMany({
      where: { userId: { in: userIds }, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { userId: true, ipLastSeen: true, locationLastSeen: true },
    });
    const deviceMap = new Map<string, (typeof devices)[number]>();
    for (const d of devices) if (!deviceMap.has(d.userId)) deviceMap.set(d.userId, d);

    // Pull just the last message per thread in one query.
    const lastMessages: Array<Pick<SupportMessage, 'threadId' | 'body'>> =
      await (this.prisma as unknown as WithSupport).supportMessage.findMany({
        where: {
          threadId: { in: threads.map((t: SupportThread) => t.id) },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['threadId'],
        select: { threadId: true, body: true },
      });
    const bodyMap = new Map(
      lastMessages.map((m) => [m.threadId, m.body] as const),
    );

    return threads.map((t: SupportThread) => {
      const row = t as unknown as {
        userId: string | null
        guestName?: string | null
        guestEmail?: string | null
      }
      const u = row.userId ? userMap.get(row.userId) : undefined;
      // Guest threads: fall back to the captured guest name/email.
      const name = u
        ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null
        : row.guestName ?? 'Guest';
      const dev = row.userId ? deviceMap.get(row.userId) : undefined;
      const geoRaw = (dev?.locationLastSeen ?? null) as Record<string, unknown> | null;
      const lastGeo = geoRaw
        ? {
            city: typeof geoRaw.city === 'string' ? (geoRaw.city as string) : null,
            region: typeof geoRaw.region === 'string' ? (geoRaw.region as string) : null,
            country: typeof geoRaw.country === 'string' ? (geoRaw.country as string) : null,
            countryCode:
              typeof geoRaw.countryCode === 'string'
                ? (geoRaw.countryCode as string).toUpperCase()
                : null,
          }
        : null;
      return {
        ...t,
        customerName: name,
        customerEmail: u?.email ?? row.guestEmail ?? '',
        lastBody: bodyMap.get(t.id) ?? null,
        lastIp: dev?.ipLastSeen ?? null,
        lastGeo,
      };
    });
  }

  async listAdminMessages(threadId: string): Promise<SupportMessage[]> {
    const thread = await (this.prisma as unknown as WithSupport).supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    // Side effect: opening the thread in admin clears the unread flag.
    if (thread.unreadForAdmins) {
      await (this.prisma as unknown as WithSupport).supportThread.update({
        where: { id: threadId },
        data: { unreadForAdmins: false },
      });
      // Sidebar badge needs to drop by one — re-poll counts.
      this.events.emit('admin.queue.changed', { supportUnreadDelta: -1 });
    }
    return (this.prisma as unknown as WithSupport).supportMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async postAdminMessage(
    adminUserId: string,
    threadId: string,
    body: string,
  ): Promise<SupportMessage> {
    const trimmed = body.trim();
    if (!trimmed) throw new ForbiddenException('Empty message');
    const thread = await (this.prisma as unknown as WithSupport).supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const [message] = await this.prisma.$transaction([
      (this.prisma as unknown as WithSupport).supportMessage.create({
        data: {
          threadId,
          senderId: adminUserId,
          senderRole: SupportSenderRole.admin,
          body: trimmed,
        },
      }),
      (this.prisma as unknown as WithSupport).supportThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          unreadForAdmins: false,
        },
      }),
    ]);

    this.emitMessageCreated(thread, message);
    return message;
  }

  /**
   * Customer-initiated: stamp every admin-authored message in the thread
   * with `readAt = now`. Emits a single nest event listing the touched
   * message IDs so the realtime gateway can push a `support.messages.read`
   * payload to the admin room — the admin UI uses this to render "Seen"
   * under the last reply.
   */
  async markAdminMessagesRead(
    userId: string,
    threadId: string,
  ): Promise<{ markedIds: string[] }> {
    const thread = await (this.prisma as unknown as WithSupport).supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread || thread.userId !== userId) {
      throw new NotFoundException('Thread not found');
    }
    const now = new Date();
    const unread: { id: string }[] = await (
      this.prisma as unknown as WithSupport
    ).supportMessage.findMany({
      where: {
        threadId,
        senderRole: SupportSenderRole.admin,
        readAt: null,
      },
      select: { id: true },
    });
    if (unread.length === 0) return { markedIds: [] };
    const ids = unread.map((m) => m.id);
    await (this.prisma as unknown as WithSupport).supportMessage.updateMany({
      where: { id: { in: ids } },
      data: { readAt: now },
    });
    this.events.emit(SUPPORT_NEST_EVENT.MessagesRead, {
      threadId,
      customerUserId: userId,
      messageIds: ids,
      readAt: now.toISOString(),
    } satisfies SupportMessagesReadPayload);
    return { markedIds: ids };
  }

  async closeThread(threadId: string, closedByUserId?: string): Promise<SupportThread> {
    const updated: SupportThread = await (this.prisma as unknown as WithSupport).supportThread.update({
      where: { id: threadId },
      data: { status: SupportThreadStatus.closed },
    });
    // Tell the customer so the UI can render a system notice and prompt
    // them to open a fresh thread by sending another message.
    this.events.emit(SUPPORT_NEST_EVENT.ThreadClosed, {
      threadId: updated.id,
      customerUserId: updated.userId,
      closedByUserId: closedByUserId ?? '',
      closedAt: new Date().toISOString(),
    } satisfies SupportThreadClosedPayload);
    return updated;
  }

  async reopenThread(threadId: string): Promise<SupportThread> {
    return (this.prisma as unknown as WithSupport).supportThread.update({
      where: { id: threadId },
      data: { status: SupportThreadStatus.open },
    });
  }

  // ─── Guest-side (logged-out visitors) ─────────────────────────────────

  /** Create a brand-new guest thread from the name/email intake. The
   *  returned thread id is what the caller signs into a guest token. */
  async openGuestThread(name: string, email: string): Promise<SupportThread> {
    const guestName = (name ?? '').trim().slice(0, 120) || 'Guest';
    const guestEmail = (email ?? '').trim().slice(0, 200);
    const thread: SupportThread = await (
      this.prisma as unknown as WithSupport
    ).supportThread.create({
      data: {
        guestId: randomUUID(),
        guestName,
        guestEmail,
        status: SupportThreadStatus.open,
      },
    });
    return thread;
  }

  /** Load a guest thread by id, asserting it really is a guest thread.
   *  Authorization (does THIS visitor own it) is the signed token, checked
   *  in the controller/gateway — this only guards the shape. */
  async getGuestThread(threadId: string): Promise<SupportThread> {
    const thread = await (
      this.prisma as unknown as WithSupport
    ).supportThread.findUnique({ where: { id: threadId } });
    if (!thread || !(thread as { guestId?: string | null }).guestId) {
      throw new NotFoundException('Thread not found');
    }
    return thread;
  }

  async listGuestMessages(threadId: string): Promise<SupportMessage[]> {
    await this.getGuestThread(threadId);
    return (this.prisma as unknown as WithSupport).supportMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async postGuestMessage(
    threadId: string,
    body: string,
  ): Promise<SupportMessage> {
    const trimmed = body.trim();
    if (!trimmed) throw new ForbiddenException('Empty message');
    const thread = await this.getGuestThread(threadId);
    if (thread.status === SupportThreadStatus.closed) {
      throw new ForbiddenException('THREAD_CLOSED');
    }
    const isFirstMessage =
      (await (this.prisma as unknown as WithSupport).supportMessage.count({
        where: { threadId },
      })) === 0;

    const [message] = await this.prisma.$transaction([
      (this.prisma as unknown as WithSupport).supportMessage.create({
        data: {
          threadId,
          senderId: null,
          // String literal (not the enum) so this compiles before the
          // post-migration `prisma generate` adds `guest` to the enum type.
          senderRole: 'guest',
          body: trimmed,
        },
      }),
      (this.prisma as unknown as WithSupport).supportThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          unreadForAdmins: true,
          status: SupportThreadStatus.open,
        },
      }),
    ]);

    this.emitMessageCreated(thread, message);
    if (isFirstMessage) void this.notifyAdminsGuestEmail(thread, trimmed);
    return message;
  }

  private async notifyAdminsGuestEmail(
    thread: SupportThread,
    body: string,
  ): Promise<void> {
    try {
      const g = thread as unknown as {
        guestName?: string | null
        guestEmail?: string | null
      };
      const who = g.guestName || 'A visitor';
      await this.email.send({
        to: this.adminEmail,
        subject: `[State Bank Support] New GUEST chat from ${who}`,
        text:
          `${who} (${g.guestEmail ?? 'no email'}) started a guest support ` +
          `chat (not signed in).\n\n` +
          `> ${body}\n\n` +
          `Reply in the admin panel: /admin/support/${thread.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `guest support email notification failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private emitMessageCreated(
    thread: SupportThread,
    message: SupportMessage,
  ): void {
    this.events.emit(SUPPORT_NEST_EVENT.MessageCreated, {
      threadId: thread.id,
      customerUserId: thread.userId,
      message: {
        id: message.id,
        threadId: message.threadId,
        senderId: message.senderId,
        senderRole: message.senderRole,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      },
      at: new Date(),
    } satisfies SupportMessageCreatedPayload);
    // Nudge the admin sidebar to re-pull queue counts (the support unread
    // total moved). Customer messages bump it up; admin replies indirectly
    // clear `unreadForAdmins` via markThreadRead, which fires its own
    // event below — so we only need to trigger on the customer side.
    if (
      message.senderRole === SupportSenderRole.customer ||
      (message.senderRole as string) === 'guest'
    ) {
      this.events.emit('admin.queue.changed', { supportUnreadDelta: 1 });
    }
  }

  private async notifyAdminsByEmail(
    thread: SupportThread,
    body: string,
    userId: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      });
      const customerName =
        [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
        user?.email ||
        'A customer';
      await this.email.send({
        to: this.adminEmail,
        subject: `[State Bank Support] New chat from ${customerName}`,
        text:
          `${customerName} (${user?.email ?? 'unknown'}) opened a new ` +
          `support chat.\n\n` +
          `> ${body}\n\n` +
          `Reply in the admin panel: /admin/support/${thread.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `support email notification failed: ${(err as Error).message}`,
      );
    }
  }
}
