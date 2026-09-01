import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

@Injectable()
export class AuditSigner {
  private readonly logger = new Logger(AuditSigner.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const k = config.get<string>('ADMIN_AUDIT_HMAC_KEY') ?? '';
    if (!k) this.logger.warn('ADMIN_AUDIT_HMAC_KEY not set; audit signatures use empty key.');
    this.key = Buffer.from(k, 'utf8');
  }

  sign(payload: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: object;
    createdAt: Date;
  }): string {
    const canonical = JSON.stringify({
      actorUserId: payload.actorUserId,
      action: payload.action,
      targetType: payload.targetType,
      targetId: payload.targetId,
      metadata: payload.metadata,
      createdAt: payload.createdAt.toISOString(),
    });
    return createHmac('sha256', this.key).update(canonical).digest('hex');
  }
}
