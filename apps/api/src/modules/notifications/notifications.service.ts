import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Notification, NotificationCategory, NotificationPreference, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePreferencesDto } from './dto/notifications.dto';
import {
  NOTIFICATION_NEST_EVENT,
  NestNotificationCreatedPayload,
  NestNotificationReadPayload,
} from './notifications.events';

export interface CreateNotificationInput {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  ctaUrl?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async list(userId: string, opts: { unreadOnly?: boolean; limit?: number }) {
    return this.prisma.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 100),
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const result = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) this.emitRead(userId, ids);
    return result.count;
  }

  async markAllRead(userId: string): Promise<number> {
    const unread = await this.prisma.notification.findMany({
      where: { userId, readAt: null },
      select: { id: true },
    });
    if (!unread.length) return 0;
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.emitRead(userId, unread.map((n) => n.id));
    return result.count;
  }

  async getPreferences(userId: string): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {
        txAll: dto.txAll ?? undefined,
        txLargeOnly: dto.txLargeOnly ?? undefined,
        txLargeThresholdCents: dto.txLargeThresholdCents ?? undefined,
        securityAlerts: dto.securityAlerts ?? undefined,
        marketingEmail: dto.marketingEmail ?? undefined,
        marketingPush: dto.marketingPush ?? undefined,
      },
      create: {
        userId,
        txAll: dto.txAll ?? true,
        txLargeOnly: dto.txLargeOnly ?? false,
        txLargeThresholdCents: dto.txLargeThresholdCents ?? 10_000n,
        securityAlerts: dto.securityAlerts ?? true,
        marketingEmail: dto.marketingEmail ?? true,
        marketingPush: dto.marketingPush ?? false,
      },
    });
  }

  async create(input: CreateNotificationInput, tx?: Prisma.TransactionClient): Promise<Notification> {
    const client = tx ?? this.prisma;
    const row = await client.notification.create({
      data: {
        userId: input.userId,
        category: input.category,
        title: input.title,
        body: input.body,
        ctaUrl: input.ctaUrl ?? null,
      },
    });
    this.events.emit(NOTIFICATION_NEST_EVENT.Created, {
      userId: row.userId,
      notificationId: row.id,
      category: row.category,
      title: row.title,
      body: row.body,
      ctaUrl: row.ctaUrl,
      at: row.createdAt,
    } satisfies NestNotificationCreatedPayload);
    return row;
  }

  async clearAll(userId: string): Promise<number> {
    const result = await this.prisma.notification.deleteMany({ where: { userId } });
    return result.count;
  }

  private emitRead(userId: string, notificationIds: string[]) {
    this.events.emit(NOTIFICATION_NEST_EVENT.Read, {
      userId,
      notificationIds,
      at: new Date(),
    } satisfies NestNotificationReadPayload);
  }
}
