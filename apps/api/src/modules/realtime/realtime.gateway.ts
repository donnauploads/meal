import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtCryptoService } from '../crypto/jwt.service';
import {
  LinkedAccountChangedPayload,
  NEST_EVENT,
  NestAccountBalanceChangedPayload,
  NestAdminMessagePayload,
  NestSessionRevokedPayload,
  NestTransactionCreatedPayload,
  NestTransactionSettledPayload,
  NestTransactionUpdatedPayload,
} from './events';
import {
  NOTIFICATION_NEST_EVENT,
  NestNotificationCreatedPayload,
  NestNotificationReadPayload,
} from '../notifications/notifications.events';
import {
  SUPPORT_NEST_EVENT,
  SUPPORT_REALTIME_EVENT,
  SupportMessageCreatedPayload,
  SupportMessagesReadPayload,
  SupportThreadClosedPayload,
} from '../support/support.events';
import { REALTIME_EVENT } from './events';

// Mirror the Express CORS logic from main.ts so the gateway accepts the
// same origins. Without this, an unset (or comma-mistyped) CORS_ORIGIN
// silently rejects every WS handshake — symptom is admin presence stuck
// at "Offline" and zero realtime messages on Vercel/Railway deploys.
const wsCorsOrigin: boolean | string[] = (() => {
  const raw = (process.env.CORS_ORIGIN ?? '').trim();
  if (!raw || raw === '*') {
    // Dev / unset: reflect the caller's origin (still works with
    // credentials, unlike literal "*"). Prod runs with an explicit list.
    return true;
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
})();

@WebSocketGateway({
  cors: { origin: wsCorsOrigin, credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  /**
   * Per-admin support-chat presence. `status` is what that admin self-reported
   * (admins on the support page emit `online`; tab-hidden for 5+ minutes flips
   * them to `away`; navigating away also goes to `away`). The map is keyed by
   * userId so multiple tabs/devices for the same admin collapse to one entry.
   * Disconnect of the last socket for an admin removes the entry entirely;
   * with the entry gone they are reported `offline` in the aggregate.
   */
  private adminPresence = new Map<
    string,
    { status: 'online' | 'away'; sockets: Set<string>; updatedAt: number }
  >();

  constructor(private readonly jwt: JwtCryptoService) {}

  handleConnection(client: Socket) {
    try {
      // A socket that presents a guest-support token explicitly WANTS the
      // guest path — honor it before anything else. Otherwise a stale
      // `access_token` cookie (the browser still sends it via
      // `withCredentials` right after logout) would win, the "guest" would
      // be joined to a `user:{id}` room instead of `support:guest:{tid}`,
      // and admin replies (emitted to the guest room) would never reach it.
      const guestToken = (
        client.handshake.auth as { guestToken?: string } | undefined
      )?.guestToken;
      if (guestToken) {
        if (this.tryGuestConnection(client)) return;
        // Token present but invalid/expired — don't silently fall through to
        // an unrelated cookie identity; reject so the client reconnects clean.
        client.disconnect(true);
        return;
      }

      const token = this.extractToken(client);
      if (!token) {
        // No access token — this may still be a logged-out GUEST support
        // visitor connecting with a signed guest-support token. If so, let
        // them join ONLY their own thread room; otherwise reject.
        if (this.tryGuestConnection(client)) return;
        client.disconnect(true);
        return;
      }
      let claims;
      try {
        claims = this.jwt.verifyAccess(token);
      } catch {
        // The token wasn't a valid access token — try treating it as a
        // guest-support token before giving up.
        if (this.tryGuestConnection(client)) return;
        throw new Error('invalid access token');
      }
      client.data.userId = claims.sub;
      client.data.sessionId = claims.sid;
      client.data.role = claims.role;
      client.join(`user:${claims.sub}`);
      client.join(`session:${claims.sid}`);
      // Admins (and superadmins) share a single broadcast room used by
      // the support chat system for incoming customer messages.
      if (claims.role === 'admin' || claims.role === 'superadmin') {
        client.join('support:admins');
        // Default an admin to `away` on connect — they're authenticated but
        // not necessarily on the support page yet. The page itself emits
        // `support.admin.presence` { status: 'online' } on mount to upgrade.
        const entry = this.adminPresence.get(claims.sub) ?? {
          status: 'away',
          sockets: new Set<string>(),
          updatedAt: Date.now(),
        };
        entry.sockets.add(client.id);
        this.adminPresence.set(claims.sub, entry);
        this.broadcastPresence();
      }
      this.logger.log(`socket connected user=${claims.sub} session=${claims.sid} role=${claims.role}`);
    } catch (err) {
      this.logger.warn(`socket auth failed: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data?.userId) this.logger.log(`socket disconnected user=${client.data.userId}`);
    const userId = client.data?.userId as string | undefined;
    const role = client.data?.role as string | undefined;
    if (userId && (role === 'admin' || role === 'superadmin')) {
      const entry = this.adminPresence.get(userId);
      if (entry) {
        entry.sockets.delete(client.id);
        if (entry.sockets.size === 0) {
          this.adminPresence.delete(userId);
          this.broadcastPresence();
        }
      }
    }
  }

  // ─── Support-chat presence ───────────────────────────────────────────────

  /**
   * Self-reported presence from an admin tab. Only `online` / `away` are
   * accepted — `offline` is derived from socket disconnect, not from the
   * client telling us so.
   */
  @SubscribeMessage('support.admin.presence')
  onAdminPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { status?: 'online' | 'away' },
  ) {
    const role = client.data?.role as string | undefined;
    const userId = client.data?.userId as string | undefined;
    if (!userId || (role !== 'admin' && role !== 'superadmin')) return;
    if (payload?.status !== 'online' && payload?.status !== 'away') return;
    const entry = this.adminPresence.get(userId) ?? {
      status: 'away' as 'online' | 'away',
      sockets: new Set<string>([client.id]),
      updatedAt: Date.now(),
    };
    if (entry.status === payload.status) return; // no-op
    entry.status = payload.status;
    entry.updatedAt = Date.now();
    this.adminPresence.set(userId, entry);
    this.broadcastPresence();
  }

  /**
   * Lets a freshly-opened customer chat widget pull the current state
   * without waiting for the next admin tick. The reply is the same shape
   * as the broadcast.
   */
  @SubscribeMessage('support.presence.query')
  onPresenceQuery(@ConnectedSocket() client: Socket) {
    client.emit('support.presence.changed', this.computePresence());
  }

  private computePresence(): { status: 'online' | 'away' | 'offline' } {
    if (this.adminPresence.size === 0) return { status: 'offline' };
    let hasAway = false;
    for (const entry of this.adminPresence.values()) {
      if (entry.status === 'online') return { status: 'online' };
      hasAway = true;
    }
    return { status: hasAway ? 'away' : 'offline' };
  }

  private broadcastPresence() {
    // Fan out to every connected socket — both customer widgets and other
    // admin tabs may render the indicator.
    this.server.emit('support.presence.changed', this.computePresence());
  }

  @OnEvent(NEST_EVENT.SessionRevoked)
  onSessionRevoked(payload: NestSessionRevokedPayload) {
    this.server.to(`session:${payload.sessionId}`).emit(REALTIME_EVENT.SessionRevoked, {
      type: REALTIME_EVENT.SessionRevoked,
      sessionId: payload.sessionId,
      userId: payload.userId,
      reason: payload.reason,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NEST_EVENT.TransactionCreated)
  onTransactionCreated(payload: NestTransactionCreatedPayload) {
    this.server.to(`user:${payload.userId}`).emit('transaction.created', {
      type: 'transaction.created',
      userId: payload.userId,
      accountId: payload.accountId,
      transactionId: payload.transactionId,
      amountCents: payload.amountCents,
      status: payload.status,
      at: payload.at.toISOString(),
      description: payload.description,
      category: payload.category,
      occurredAt: payload.occurredAt,
      kind: payload.kind,
    });
  }

  @OnEvent(NEST_EVENT.TransactionSettled)
  onTransactionSettled(payload: NestTransactionSettledPayload) {
    this.server.to(`user:${payload.userId}`).emit('transaction.settled', {
      type: 'transaction.settled',
      userId: payload.userId,
      accountId: payload.accountId,
      transactionId: payload.transactionId,
      transferId: payload.transferId,
      amountCents: payload.amountCents,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NEST_EVENT.TransactionUpdated)
  onTransactionUpdated(payload: NestTransactionUpdatedPayload) {
    this.server.to(`user:${payload.userId}`).emit('transaction.updated', {
      type: 'transaction.updated',
      userId: payload.userId,
      accountId: payload.accountId,
      transactionId: payload.transactionId,
      effective: payload.effective,
      hidden: payload.hidden,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NEST_EVENT.AccountBalanceChanged)
  onAccountBalanceChanged(payload: NestAccountBalanceChangedPayload) {
    this.server.to(`user:${payload.userId}`).emit('account.balanceChanged', {
      type: 'account.balanceChanged',
      userId: payload.userId,
      accountId: payload.accountId,
      balanceCents: payload.balanceCents,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NEST_EVENT.LinkedAccountChanged)
  onLinkedAccountChanged(payload: LinkedAccountChangedPayload) {
    this.server.to(`user:${payload.userId}`).emit('linkedAccount.changed', {
      type: 'linkedAccount.changed',
      userId: payload.userId,
      requestId: payload.requestId,
      kind: payload.kind,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NOTIFICATION_NEST_EVENT.Created)
  onNotificationCreated(payload: NestNotificationCreatedPayload) {
    this.server.to(`user:${payload.userId}`).emit('notification.created', {
      type: 'notification.created',
      userId: payload.userId,
      notificationId: payload.notificationId,
      category: payload.category,
      title: payload.title,
      body: payload.body,
      ctaUrl: payload.ctaUrl,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NOTIFICATION_NEST_EVENT.Read)
  onNotificationRead(payload: NestNotificationReadPayload) {
    this.server.to(`user:${payload.userId}`).emit('notification.read', {
      type: 'notification.read',
      userId: payload.userId,
      notificationIds: payload.notificationIds,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(NEST_EVENT.AdminMessage)
  onAdminMessage(payload: NestAdminMessagePayload) {
    this.server.to(`user:${payload.userId}`).emit('admin.message', {
      type: 'admin.message',
      userId: payload.userId,
      messageId: payload.messageId,
      title: payload.title,
      body: payload.body,
      at: payload.at.toISOString(),
    });
  }

  @OnEvent(SUPPORT_NEST_EVENT.MessageCreated)
  onSupportMessageCreated(payload: SupportMessageCreatedPayload) {
    const wire = {
      type: SUPPORT_REALTIME_EVENT.MessageCreated,
      threadId: payload.threadId,
      message: payload.message,
      at: payload.at.toISOString(),
    };
    // Both sides of the conversation get the same wire payload — the
    // customer/guest UI sees admin replies, the admin queue sees new
    // inbound messages, both without polling. Guest threads have no
    // userId, so they're routed to the per-thread guest room instead.
    if (payload.customerUserId) {
      this.server
        .to(`user:${payload.customerUserId}`)
        .emit(SUPPORT_REALTIME_EVENT.MessageCreated, wire);
    } else {
      this.server
        .to(`support:guest:${payload.threadId}`)
        .emit(SUPPORT_REALTIME_EVENT.MessageCreated, wire);
    }
    this.server
      .to('support:admins')
      .emit(SUPPORT_REALTIME_EVENT.MessageCreated, wire);
  }

  /**
   * Customer marked the admin's replies as read — fan-out to admins so
   * the conversation pane can show "Seen" under the appropriate row.
   * Not sent back to the customer (they already know they read it).
   */
  /**
   * Admin closed the thread → push a notice to the customer so the chat
   * UI can render a "session closed" banner and force a fresh thread on
   * the next send. Also fan out to admins so other open tabs collapse
   * the conversation appropriately.
   */
  @OnEvent(SUPPORT_NEST_EVENT.ThreadClosed)
  onSupportThreadClosed(payload: SupportThreadClosedPayload) {
    const wire = {
      threadId: payload.threadId,
      closedAt: payload.closedAt,
    };
    if (payload.customerUserId) {
      this.server
        .to(`user:${payload.customerUserId}`)
        .emit(SUPPORT_REALTIME_EVENT.ThreadClosed, wire);
    } else {
      this.server
        .to(`support:guest:${payload.threadId}`)
        .emit(SUPPORT_REALTIME_EVENT.ThreadClosed, wire);
    }
    this.server
      .to('support:admins')
      .emit(SUPPORT_REALTIME_EVENT.ThreadClosed, wire);
  }

  @OnEvent(SUPPORT_NEST_EVENT.MessagesRead)
  onSupportMessagesRead(payload: SupportMessagesReadPayload) {
    this.server.to('support:admins').emit(SUPPORT_REALTIME_EVENT.MessagesRead, {
      threadId: payload.threadId,
      customerUserId: payload.customerUserId,
      messageIds: payload.messageIds,
      readAt: payload.readAt,
    });
  }

  /**
   * Bidirectional typing relay. Either side emits `support.typing` with
   * `{ threadId, isTyping }`; we authenticate via the socket's claims
   * and forward the event to the other party in that thread:
   *   - customer → 'support:admins' room
   *   - admin    → 'user:{customerUserId}' room (resolved by looking up
   *                the thread; we accept it on the payload to avoid the
   *                extra round-trip for what is just a UI hint).
   */
  @SubscribeMessage(SUPPORT_REALTIME_EVENT.Typing)
  onTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { threadId: string; isTyping: boolean; customerUserId?: string },
  ) {
    if (!payload || typeof payload.threadId !== 'string') return;
    const isGuest = client.data.guest === true;
    const role = client.data.role as string | undefined;
    const userId = client.data.userId as string | undefined;
    if (!isGuest && (!role || !userId)) return;

    const senderRole = isGuest
      ? 'guest'
      : role === 'admin' || role === 'superadmin'
        ? 'admin'
        : 'customer';
    const wire = {
      threadId: payload.threadId,
      isTyping: !!payload.isTyping,
      senderRole,
      at: new Date().toISOString(),
    };
    if (senderRole === 'admin') {
      // Admin → the customer's user room, or the guest's per-thread room.
      if (payload.customerUserId) {
        this.server
          .to(`user:${payload.customerUserId}`)
          .emit(SUPPORT_REALTIME_EVENT.Typing, wire);
      } else {
        this.server
          .to(`support:guest:${payload.threadId}`)
          .emit(SUPPORT_REALTIME_EVENT.Typing, wire);
      }
    } else {
      // Customer or guest → the admin room.
      this.server.to('support:admins').emit(SUPPORT_REALTIME_EVENT.Typing, wire);
    }
  }

  /**
   * Broadcast admin queue deltas to anyone in the `support:admins` room
   * (we reuse it for all admin-facing channels). The badge in the
   * sidebar listens for this and adjusts its counts without refetching.
   */
  @OnEvent('admin.queue.changed')
  onAdminQueueChanged(payload: { kycDelta?: number; transferReviewDelta?: number }) {
    this.server.to('support:admins').emit('admin.queue.changed', {
      kycDelta: payload.kycDelta ?? 0,
      transferReviewDelta: payload.transferReviewDelta ?? 0,
      at: new Date().toISOString(),
    });
  }

  /**
   * Logged-out guest support: verify the guest token and, if valid, join the
   * visitor to ONLY their own thread room (`support:guest:{threadId}`). They
   * get no user/session rooms and no admin privileges. Returns true when the
   * connection was accepted as a guest.
   */
  private tryGuestConnection(client: Socket): boolean {
    const guestToken = (client.handshake.auth as { guestToken?: string } | undefined)
      ?.guestToken;
    if (!guestToken) return false;
    try {
      const { tid } = this.jwt.verifyGuestSupport(guestToken);
      client.data.guest = true;
      client.data.guestThreadId = tid;
      client.join(`support:guest:${tid}`);
      this.logger.log(`guest support socket connected thread=${tid}`);
      return true;
    } catch {
      return false;
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const cookie = client.handshake.headers.cookie;
    if (cookie) {
      const match = /(?:^|;\s*)access_token=([^;]+)/.exec(cookie);
      if (match) return decodeURIComponent(match[1]);
    }
    return undefined;
  }
}
