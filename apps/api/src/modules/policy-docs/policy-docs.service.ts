import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyRenderer } from './policy.renderer';

@Injectable()
export class PolicyDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: PolicyRenderer,
  ) {}

  async renderPdf(slug: string): Promise<{ pdf: Buffer; filename: string }> {
    const row = await this.prisma.policyDoc.findFirst({
      where: { slug },
      orderBy: { effectiveAt: 'desc' },
    });
    if (!row) throw new NotFoundException('Policy not found');
    const pdf = await this.renderer.render({
      title: row.title,
      version: row.version,
      effectiveAt: row.effectiveAt,
      bodyMd: row.bodyMd,
    });
    const safeTitle = row.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    const filename = `State Bank-${safeTitle}-v${row.version}.pdf`;
    return { pdf, filename };
  }

  async listLatest() {
    const all = await this.prisma.policyDoc.findMany({
      orderBy: [{ slug: 'asc' }, { effectiveAt: 'desc' }],
    });
    const bySlug = new Map<string, (typeof all)[number]>();
    for (const d of all) if (!bySlug.has(d.slug)) bySlug.set(d.slug, d);
    return Array.from(bySlug.values()).map((d) => ({
      slug: d.slug,
      title: d.title,
      version: d.version,
      effectiveAt: d.effectiveAt.toISOString(),
    }));
  }

  async getLatestBySlug(slug: string) {
    const row = await this.prisma.policyDoc.findFirst({
      where: { slug },
      orderBy: { effectiveAt: 'desc' },
    });
    if (!row) throw new NotFoundException('Policy not found');
    return {
      slug: row.slug,
      title: row.title,
      version: row.version,
      effectiveAt: row.effectiveAt.toISOString(),
      bodyMd: row.bodyMd,
    };
  }

  async versionsForSlug(slug: string) {
    const rows = await this.prisma.policyDoc.findMany({
      where: { slug },
      orderBy: { effectiveAt: 'desc' },
      select: { id: true, version: true, effectiveAt: true, title: true },
    });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      title: r.title,
      effectiveAt: r.effectiveAt.toISOString(),
    }));
  }
}
