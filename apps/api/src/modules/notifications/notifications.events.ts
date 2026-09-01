export const NOTIFICATION_NEST_EVENT = {
  Created: 'nest.notification.created',
  Read: 'nest.notification.read',
} as const;

export interface NestNotificationCreatedPayload {
  userId: string;
  notificationId: string;
  category: string;
  title: string;
  body: string;
  ctaUrl: string | null;
  at: Date;
}

export interface NestNotificationReadPayload {
  userId: string;
  notificationIds: string[];
  at: Date;
}
