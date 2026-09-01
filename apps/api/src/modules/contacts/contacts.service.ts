import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, q?: string) {
    return this.prisma.contact.findMany({
      where: {
        ownerUserId: userId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { handle: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phoneE164: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastUsedAt: 'desc' }, { name: 'asc' }],
      take: 100,
    });
  }

  async recents(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { ownerUserId: userId, NOT: { lastUsedAt: null } },
      orderBy: { lastUsedAt: 'desc' },
      take: 10,
    });
    if (contacts.length === 0) return [];

    // Resolve each contact to a live State Bank user (if any) so the FE can
    // show the user's current display picture, not a stale snapshot the
    // contact row was created with. Match by novaTag → email → phone,
    // building a single OR query to avoid N+1 lookups.
    const handles = contacts.map((c) => c.handle).filter((s): s is string => !!s);
    const emails = contacts.map((c) => c.email).filter((s): s is string => !!s);
    const phones = contacts
      .map((c) => c.phoneE164)
      .filter((s): s is string => !!s);

    const novaUsers =
      handles.length || emails.length || phones.length
        ? await this.prisma.user.findMany({
            where: {
              OR: [
                ...(handles.length ? [{ novaTag: { in: handles } }] : []),
                ...(emails.length ? [{ email: { in: emails } }] : []),
                ...(phones.length ? [{ phoneE164: { in: phones } }] : []),
              ],
            },
            select: {
              id: true,
              novaTag: true,
              email: true,
              phoneE164: true,
              avatarUrl: true,
            },
          })
        : [];

    const byHandle = new Map<string, (typeof novaUsers)[number]>();
    const byEmail = new Map<string, (typeof novaUsers)[number]>();
    const byPhone = new Map<string, (typeof novaUsers)[number]>();
    for (const u of novaUsers) {
      if (u.novaTag) byHandle.set(u.novaTag.toLowerCase(), u);
      if (u.email) byEmail.set(u.email.toLowerCase(), u);
      if (u.phoneE164) byPhone.set(u.phoneE164, u);
    }

    return contacts.map((c) => {
      const matched =
        (c.handle && byHandle.get(c.handle.toLowerCase())) ||
        (c.email && byEmail.get(c.email.toLowerCase())) ||
        (c.phoneE164 && byPhone.get(c.phoneE164)) ||
        null;
      return {
        id: c.id,
        ownerUserId: c.ownerUserId,
        userId: matched?.id ?? null,
        name: c.name,
        handle: c.handle,
        email: c.email,
        phoneE164: c.phoneE164,
        // Live user avatar wins over the contact's stored snapshot. Both
        // fall back to null so the FE renders its initials chip.
        avatarUrl: matched?.avatarUrl ?? c.avatarUrl ?? null,
        lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
      };
    });
  }

  create(userId: string, dto: CreateContactDto) {
    return this.prisma.contact.create({ data: { ownerUserId: userId, ...dto } });
  }

  async update(userId: string, id: string, dto: UpdateContactDto) {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing || existing.ownerUserId !== userId) throw new NotFoundException('Contact not found');
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  async delete(userId: string, id: string) {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing || existing.ownerUserId !== userId) throw new NotFoundException('Contact not found');
    await this.prisma.contact.delete({ where: { id } });
  }

  async touch(userId: string, id: string) {
    await this.prisma.contact.updateMany({
      where: { id, ownerUserId: userId },
      data: { lastUsedAt: new Date() },
    });
  }
}
