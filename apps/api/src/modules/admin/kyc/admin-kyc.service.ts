import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentStatus, KycStatus } from '@prisma/client';
import { KycService } from '../../kyc/kyc.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { KycDecisionDto, DocumentDecisionDto } from '../dto/admin.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from '../../documents/storage/storage.interface';

@Injectable()
export class AdminKycService {
  constructor(
    private readonly kyc: KycService,
    private readonly audit: AdminAuditService,
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async listQueue(opts: {
    limit?: number;
    cursor?: string;
    statuses?: string;
    from?: string;
    to?: string;
  } = {}) {
    // Always use listAll() so the All / Approved / Rejected tabs return
    // real data. `statuses` left undefined = all four buckets.
    const allowed = new Set(['pending', 'in_review', 'approved', 'rejected']);
    const parsedStatuses = opts.statuses
      ? (opts.statuses
          .split(',')
          .map((s) => s.trim())
          .filter((s) => allowed.has(s)) as KycStatus[])
      : undefined;
    const from = opts.from ? new Date(opts.from) : undefined;
    const to = opts.to ? new Date(opts.to) : undefined;
    return this.kyc.listAll({
      statuses: parsedStatuses,
      from: from && !isNaN(from.getTime()) ? from : undefined,
      to: to && !isNaN(to.getTime()) ? to : undefined,
      limit: opts.limit,
    });
  }

  /**
   * Full review payload for a single user: KYC record + every document
   * they've uploaded (signup or post-signup) + a short-lived URL per doc
   * so the admin can preview the file inline. Always returns a record —
   * 404 only if the userId doesn't exist.
   */
  async detail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneE164: true,
        novaTag: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');

    const kyc = await this.prisma.kycRecord.findUnique({ where: { userId } });

    // Documents — pull anything owned by this user OR by their signup
    // session (in case the row didn't migrate over on `complete`).
    // SignupSession has no userId column — we link by the user's email
    // (which is unique on both User and SignupSession).
    const signup = user.email
      ? await this.prisma.signupSession.findUnique({
          where: { email: user.email },
          select: { id: true },
        })
      : null;
    const docs = await this.prisma.document.findMany({
      where: {
        OR: [
          { ownerUserId: userId },
          ...(signup ? [{ ownerSignupId: signup.id }] : []),
        ],
      },
      orderBy: { uploadedAt: 'asc' },
    });
    const docsWithUrls = await Promise.all(
      docs.map(async (d) => ({
        id: d.id,
        type: d.type,
        subtype: d.subtype,
        status: d.status,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.uploadedAt.toISOString(),
        reviewedAt: d.reviewedAt?.toISOString() ?? null,
        rejectionReason: d.rejectionReason,
        // 30-minute presigned URL (or relative /storage path on filesystem)
        previewUrl: await this.storage
          .getPresignedDownloadUrl(d.storageKey, 1800)
          .catch(() => null),
      })),
    );

    return {
      user,
      kyc: kyc
        ? {
            id: kyc.id,
            status: kyc.status,
            submittedAt: kyc.submittedAt.toISOString(),
            reviewedAt: kyc.reviewedAt?.toISOString() ?? null,
            reviewedByUserId: kyc.reviewedByUserId,
            rejectionReason: kyc.rejectionReason,
            missingFields: kyc.missingFields,
          }
        : null,
      documents: docsWithUrls,
    };
  }

  async decide(actorUserId: string, kycId: string, dto: KycDecisionDto) {
    if (dto.decision === 'approved') {
      const updated = await this.kyc.approve(kycId, actorUserId);
      await this.audit.write({
        actorUserId,
        action: 'kyc.approve',
        targetType: 'kyc_record',
        targetId: kycId,
        metadata: { previousStatus: 'pending', userId: updated.userId },
      });
      this.events.emit('admin.queue.changed', { kycDelta: -1 });
      return updated;
    }
    const updated = await this.kyc.reject(kycId, actorUserId, dto.reason ?? 'rejected', dto.missingFields ?? []);
    await this.audit.write({
      actorUserId,
      action: 'kyc.reject',
      targetType: 'kyc_record',
      targetId: kycId,
      metadata: { reason: dto.reason, missingFields: dto.missingFields ?? [], userId: updated.userId },
    });
    this.events.emit('admin.queue.changed', { kycDelta: -1 });
    return updated;
  }

  /**
   * Per-document approve/reject. Updates the document row and writes an
   * audit entry. We deliberately keep this independent of the overall
   * KYC decision — the admin is free to mark individual files good/bad
   * and then issue the user-level decision separately.
   */
  async decideDocument(actorUserId: string, documentId: string, dto: DocumentDecisionDto) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('DOCUMENT_NOT_FOUND');
    if (dto.decision === 'rejected' && !dto.reason?.trim()) {
      throw new BadRequestException('reason required when rejecting');
    }
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: dto.decision === 'approved' ? DocumentStatus.approved : DocumentStatus.rejected,
        reviewedAt: new Date(),
        reviewedByUserId: actorUserId,
        rejectionReason: dto.decision === 'rejected' ? dto.reason ?? null : null,
      },
    });
    await this.audit.write({
      actorUserId,
      action: dto.decision === 'approved' ? 'kyc.document.approve' : 'kyc.document.reject',
      targetType: 'document',
      targetId: documentId,
      metadata: { reason: dto.reason ?? null, ownerUserId: doc.ownerUserId, ownerSignupId: doc.ownerSignupId },
    });
    return updated;
  }
}
