import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KycStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KYC_APPROVED_EVENT, KycApprovedPayload } from '../accounts/account-provisioner.service';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async statusForUser(userId: string) {
    const record = await this.prisma.kycRecord.findUnique({ where: { userId } });
    if (!record) throw new NotFoundException('No KYC record');
    return record;
  }

  async listPending(limit = 50, cursor?: string) {
    return this.prisma.kycRecord.findMany({
      where: { status: { in: [KycStatus.pending, KycStatus.in_review] } },
      orderBy: { submittedAt: 'asc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phoneE164: true } } },
    });
  }

  /**
   * Full queue listing for the admin review page. Supports an optional
   * status filter (defaults to all four statuses), and an optional
   * submittedAt date range. Used by `/admin/kyc/queue` so the
   * Approved/Rejected tabs aren't empty.
   */
  async listAll(opts: {
    statuses?: KycStatus[];
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const statuses = opts.statuses && opts.statuses.length
      ? opts.statuses
      : ([
          KycStatus.pending,
          KycStatus.in_review,
          KycStatus.approved,
          KycStatus.rejected,
        ] as KycStatus[]);
    const where: {
      status: { in: KycStatus[] };
      submittedAt?: { gte?: Date; lte?: Date };
    } = {
      status: { in: statuses },
    };
    if (opts.from || opts.to) {
      where.submittedAt = {};
      if (opts.from) where.submittedAt.gte = opts.from;
      if (opts.to) where.submittedAt.lte = opts.to;
    }
    return this.prisma.kycRecord.findMany({
      where,
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phoneE164: true,
          },
        },
      },
    });
  }

  async approve(kycId: string, reviewerUserId: string) {
    const updated = await this.prisma.kycRecord.update({
      where: { id: kycId },
      data: { status: KycStatus.approved, reviewedAt: new Date(), reviewedByUserId: reviewerUserId, rejectionReason: null },
    });
    this.events.emit(KYC_APPROVED_EVENT, {
      userId: updated.userId,
      kycId: updated.id,
      reviewedByUserId: reviewerUserId,
      at: updated.reviewedAt ?? new Date(),
    } satisfies KycApprovedPayload);
    return updated;
  }

  async reject(kycId: string, reviewerUserId: string, reason: string, missingFields: string[] = []) {
    return this.prisma.kycRecord.update({
      where: { id: kycId },
      data: {
        status: KycStatus.rejected,
        reviewedAt: new Date(),
        reviewedByUserId: reviewerUserId,
        rejectionReason: reason,
        missingFields,
      },
    });
  }
}
