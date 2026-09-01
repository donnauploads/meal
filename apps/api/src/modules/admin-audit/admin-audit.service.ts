import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditSigner } from './audit-signer';

export interface AuditWrite {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: AuditSigner,
  ) {}

  async write(input: AuditWrite, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const createdAt = new Date();
    const signature = this.signer.sign({ ...input, createdAt });
    try {
      await client.adminAuditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata as object,
          signature,
          createdAt,
        },
      });
    } catch (err) {
      this.logger.error(`audit write failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async list(filters: { actorUserId?: string; targetType?: string; targetId?: string; limit?: number }) {
    return this.prisma.adminAuditLog.findMany({
      where: {
        actorUserId: filters.actorUserId,
        targetType: filters.targetType,
        targetId: filters.targetId,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 100, 500),
    });
  }
}
