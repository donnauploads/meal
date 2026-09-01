import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document, DocumentStatus, DocumentSubtype, DocumentType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from './storage/storage.interface';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export interface UploadInput {
  type: DocumentType;
  subtype?: DocumentSubtype;
  contentType: string;
  body: Buffer;
  ownerSignupId?: string;
  ownerUserId?: string;
}

@Injectable()
export class DocumentsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    config: ConfigService,
  ) {
    this.maxBytes = Number(config.get('DOC_MAX_BYTES') ?? 10 * 1024 * 1024);
  }

  async upload(input: UploadInput): Promise<Document> {
    if (!ALLOWED_MIME.has(input.contentType)) throw new BadRequestException(`Unsupported content type: ${input.contentType}`);
    if (input.body.length > this.maxBytes) throw new BadRequestException(`File exceeds ${this.maxBytes} bytes`);
    if (!input.ownerSignupId && !input.ownerUserId) throw new BadRequestException('Missing owner');

    const id = randomUUID();
    const ext = input.contentType === 'application/pdf' ? 'pdf' : input.contentType === 'image/png' ? 'png' : 'jpg';
    const ownerSegment = input.ownerSignupId ? `signup/${input.ownerSignupId}` : `user/${input.ownerUserId}`;
    const key = `${ownerSegment}/${input.type}/${id}.${ext}`;

    await this.storage.put({ key, body: input.body, contentType: input.contentType });

    return this.prisma.document.create({
      data: {
        id,
        type: input.type,
        subtype: input.subtype,
        status: DocumentStatus.pending,
        storageKey: key,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        ownerSignupId: input.ownerSignupId,
        ownerUserId: input.ownerUserId,
      },
    });
  }

  async listForSignup(signupId: string) {
    return this.prisma.document.findMany({ where: { ownerSignupId: signupId }, orderBy: { uploadedAt: 'asc' } });
  }

  async listForUser(userId: string) {
    return this.prisma.document.findMany({ where: { ownerUserId: userId }, orderBy: { uploadedAt: 'asc' } });
  }

  async getDownloadUrl(documentId: string, requestingUserId: string): Promise<string> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.ownerUserId !== requestingUserId) throw new NotFoundException('Document not found');
    return this.storage.getPresignedDownloadUrl(doc.storageKey);
  }

  async fetchBytes(key: string): Promise<Buffer> {
    return this.storage.get(key);
  }

  async transferOwnershipToUser(signupId: string, userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.document.updateMany({
      where: { ownerSignupId: signupId },
      data: { ownerSignupId: null, ownerUserId: userId },
    });
  }
}
