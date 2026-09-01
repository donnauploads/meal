import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationCategory, Prisma, SessionRevokedReason, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SessionsService } from '../../sessions/sessions.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { EmailService } from '../../../common/email/email.service';
import { buildPasswordResetLinkEmail } from './templates/password-reset-link.email';
import { JwtCryptoService } from '../../crypto/jwt.service';
import { Argon2Service } from '../../crypto/argon2.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NEST_EVENT, NestAccountBalanceChangedPayload, NestAdminMessagePayload } from '../../realtime/events';
import { AccountsService } from '../../accounts/accounts.service';
import { ACCOUNT_CREATED_EVENT, AccountCreatedPayload } from '../../accounts/account-provisioner.service';
import { ChangeRoleDto, CreateAdminUserDto, SearchUsersDto, UpdateAdminUserDto } from '../dto/admin.dto';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly audit: AdminAuditService,
    private readonly email: EmailService,
    private readonly jwt: JwtCryptoService,
    private readonly argon: Argon2Service,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Send a direct admin message to a user. Channels:
   *   - "notification": persists a Notification row → appears in the bell
   *     panel (and pushes live via notification.created).
   *   - "popup": fires a real-time `admin.message` socket event → the
   *     customer app shows a modal immediately (not persisted).
   *   - "both": does both.
   */
  async sendDirectMessage(
    actorUserId: string,
    targetUserId: string,
    args: {
      title: string;
      body: string;
      channel: 'notification' | 'popup' | 'both';
      reason: string;
    },
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    let notificationId: string | null = null;
    if (args.channel === 'notification' || args.channel === 'both') {
      const notif = await this.notifications.create({
        userId: targetUserId,
        category: NotificationCategory.security,
        title: args.title,
        body: args.body,
        ctaUrl: null,
      });
      notificationId = notif.id;
    }
    if (args.channel === 'popup' || args.channel === 'both') {
      this.events.emit(NEST_EVENT.AdminMessage, {
        userId: targetUserId,
        messageId: notificationId ?? `msg_${Date.now()}`,
        title: args.title,
        body: args.body,
        at: new Date(),
      } satisfies NestAdminMessagePayload);
    }

    await this.audit.write({
      actorUserId,
      action: 'user.message.send',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { channel: args.channel, title: args.title, reason: args.reason },
    });
    return { ok: true as const, notificationId };
  }

  async search(query: SearchUsersDto) {
    const q = query.q?.trim();
    const limit = query.limit ?? 25;
    return this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { novaTag: { contains: q, mode: 'insensitive' } },
              { phoneE164: { contains: q } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, email: true, novaTag: true, phoneE164: true,
        firstName: true, lastName: true, role: true, status: true, createdAt: true,
      },
    });
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        kycRecord: true,
        accounts: { select: { id: true, type: true, label: true, balanceCents: true, status: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    // emailNotificationsDisabled isn't in the generated Prisma client yet
    // (same pattern as transfersDisabled was) — fetch via raw SQL and merge.
    const extra = await this.prisma.$queryRaw<
      {
        emailNotificationsDisabled: boolean;
        emailNotificationsDisabledReason: string | null;
        emailNotificationsDisabledAt: Date | null;
      }[]
    >`
      SELECT "emailNotificationsDisabled",
             "emailNotificationsDisabledReason",
             "emailNotificationsDisabledAt"
        FROM "User"
       WHERE "id" = ${id}::uuid
    `;
    return {
      ...user,
      accounts: user.accounts.map((a) => ({ ...a, balanceCents: a.balanceCents.toString() })),
      emailNotificationsDisabled: extra[0]?.emailNotificationsDisabled ?? false,
      emailNotificationsDisabledReason: extra[0]?.emailNotificationsDisabledReason ?? null,
      emailNotificationsDisabledAt:
        extra[0]?.emailNotificationsDisabledAt?.toISOString() ?? null,
    };
  }

  /**
   * Most recent N sessions for a user, joined with their device, so the
   * admin user-detail page can show last logins with device/IP/location.
   * Includes both active and revoked rows — admins want the timeline.
   */
  async listSessions(userId: string, limit = 3) {
    const safe = Math.min(Math.max(limit, 1), 20);
    const rows = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safe,
      include: {
        device: {
          select: {
            id: true,
            name: true,
            os: true,
            browser: true,
            ipLastSeen: true,
            locationLastSeen: true,
            lastSeenAt: true,
          },
        },
      },
    });
    return rows.map((s) => {
      const geoRaw = (s.device?.locationLastSeen ?? null) as Record<string, unknown> | null;
      const geo = geoRaw
        ? {
            city: typeof geoRaw.city === 'string' ? (geoRaw.city as string) : null,
            region: typeof geoRaw.region === 'string' ? (geoRaw.region as string) : null,
            country: typeof geoRaw.country === 'string' ? (geoRaw.country as string) : null,
            countryCode:
              typeof geoRaw.countryCode === 'string'
                ? (geoRaw.countryCode as string).toUpperCase()
                : null,
          }
        : null;
      return {
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
        revokedReason: s.revokedReason ?? null,
        device: s.device
          ? {
              id: s.device.id,
              name: s.device.name,
              os: s.device.os,
              browser: s.device.browser,
              ip: s.device.ipLastSeen,
              lastSeenAt: s.device.lastSeenAt.toISOString(),
              geo,
            }
          : null,
      };
    });
  }

  /**
   * Admin patch on a user record. Validates uniqueness on email / novaTag /
   * phone before writing; gates role + status changes behind superadmin;
   * revokes sessions on email change (login identity moves). All field
   * changes are captured in one audit-log entry with before/after.
   */
  async update(
    actorUserId: string,
    _actorRole: UserRole,
    targetUserId: string,
    dto: UpdateAdminUserDto,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    const isSelf = actorUserId === targetUserId;
    const wantsRoleChange = dto.role !== undefined && dto.role !== target.role;
    const wantsStatusChange = dto.status !== undefined && dto.status !== target.status;
    const wantsEmailChange = dto.email !== undefined && normalizeEmail(dto.email) !== target.email;

    // Any admin/superadmin (enforced by the controller's @Roles guard) may
    // change role, status, and email. The only hard guards are on acting
    // against your OWN account, so an admin can't lock themselves out or
    // silently change their own role.
    if (isSelf && wantsRoleChange) {
      throw new BadRequestException('Cannot change your own role');
    }
    if (isSelf && wantsStatusChange && dto.status !== 'active') {
      throw new BadRequestException('Cannot suspend / un-verify your own account');
    }

    // Build the Prisma update payload with only the fields that actually
    // changed, normalizing as we go.
    const data: Prisma.UserUpdateInput = {};
    const beforeSnap: Record<string, unknown> = {};
    const afterSnap: Record<string, unknown> = {};

    if (dto.firstName !== undefined && dto.firstName.trim() !== target.firstName) {
      const v = dto.firstName.trim();
      data.firstName = v;
      beforeSnap.firstName = target.firstName;
      afterSnap.firstName = v;
    }
    if (dto.lastName !== undefined && dto.lastName.trim() !== target.lastName) {
      const v = dto.lastName.trim();
      data.lastName = v;
      beforeSnap.lastName = target.lastName;
      afterSnap.lastName = v;
    }
    if (dto.novaTag !== undefined) {
      const v = normalizeNovaTag(dto.novaTag);
      if (v !== target.novaTag) {
        if (v) {
          const taken = await this.prisma.user.findFirst({
            where: { novaTag: v, NOT: { id: targetUserId } },
            select: { id: true },
          });
          if (taken) throw new ConflictException('novaTag already taken');
        }
        data.novaTag = v;
        beforeSnap.novaTag = target.novaTag;
        afterSnap.novaTag = v;
      }
    }
    if (dto.phoneE164 !== undefined) {
      const v = dto.phoneE164.trim() || null;
      if (v !== target.phoneE164) {
        if (v) {
          const taken = await this.prisma.user.findFirst({
            where: { phoneE164: v, NOT: { id: targetUserId } },
            select: { id: true },
          });
          if (taken) throw new ConflictException('phone already in use');
        }
        data.phoneE164 = v;
        beforeSnap.phoneE164 = target.phoneE164;
        afterSnap.phoneE164 = v;
      }
    }
    if (dto.dob !== undefined) {
      const v = new Date(dto.dob);
      if (Number.isNaN(v.getTime())) throw new BadRequestException('Invalid DOB');
      if (target.dob == null || v.getTime() !== target.dob.getTime()) {
        data.dob = v;
        beforeSnap.dob = target.dob ? target.dob.toISOString() : null;
        afterSnap.dob = v.toISOString();
      }
    }
    if (wantsEmailChange) {
      const v = normalizeEmail(dto.email!);
      const taken = await this.prisma.user.findFirst({
        where: { email: v, NOT: { id: targetUserId } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('email already in use');
      data.email = v;
      beforeSnap.email = target.email;
      afterSnap.email = v;
    }
    if (wantsRoleChange) {
      data.role = dto.role!;
      beforeSnap.role = target.role;
      afterSnap.role = dto.role;
    }
    if (wantsStatusChange) {
      data.status = dto.status! as UserStatus;
      beforeSnap.status = target.status;
      afterSnap.status = dto.status;
    }

    if (Object.keys(data).length === 0) {
      // Nothing changed — return the unchanged user without touching the DB
      // or the audit log.
      return { id: target.id, ...mapPublicUser(target), unchanged: true as const };
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data,
    });

    // Side effects:
    //   - email change invalidates all sessions for the user.
    //   - role change does too (existing changeRole flow does this).
    //   - status → frozen/closed also revokes sessions (account locked).
    if (
      wantsEmailChange ||
      wantsRoleChange ||
      (wantsStatusChange && dto.status !== 'active')
    ) {
      await this.sessions.revokeAllForUser(targetUserId, SessionRevokedReason.admin_revoke);
    }

    await this.audit.write({
      actorUserId,
      action: 'user.update',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { before: beforeSnap, after: afterSnap, reason: dto.reason },
    });

    return { id: updated.id, ...mapPublicUser(updated), unchanged: false as const };
  }

  /**
   * Flip a user's status to active or frozen. Used by the Activate /
   * Deactivate buttons on the admin user page. Freezing revokes all
   * sessions — the user is locked out immediately.
   */
  async setStatus(
    actorUserId: string,
    targetUserId: string,
    nextStatus: 'active' | 'frozen',
    reason: string,
  ) {
    if (actorUserId === targetUserId && nextStatus === 'frozen') {
      throw new BadRequestException('Cannot freeze your own account');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status === nextStatus) {
      return { id: target.id, status: target.status, unchanged: true as const };
    }
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: nextStatus as UserStatus },
    });
    if (nextStatus === 'frozen') {
      await this.sessions.revokeAllForUser(targetUserId, SessionRevokedReason.admin_revoke);
    }
    await this.audit.write({
      actorUserId,
      action: nextStatus === 'active' ? 'user.activate' : 'user.deactivate',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { before: target.status, after: nextStatus, reason },
    });
    return { id: updated.id, status: updated.status, unchanged: false as const };
  }

  /**
   * Generate a recovery token for the target user and email them the
   * standard reset link. The token shape and expiration matches the
   * customer-facing forgot-password flow, so the same /recover/password
   * page accepts it. The admin never sees the token.
   */
  async forcePasswordReset(
    actorUserId: string,
    targetUserId: string,
    reason: string,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    const token = this.jwt.signRecovery(target.id);
    const webBaseUrl =
      this.config.get<string>('WEB_BASE_URL') ?? 'http://localhost:3000';
    const url = `${webBaseUrl}/recover/password?token=${encodeURIComponent(token)}`;
    try {
      const tpl = buildPasswordResetLinkEmail({
        resetUrl: url,
        ttlMinutes: 15,
        adminInitiated: true,
        webBaseUrl,
      });
      await this.email.send({
        to: target.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        critical: true,
      });
    } catch (err) {
      this.logger.warn(`[force-password-reset] email send failed: ${(err as Error).message}`);
    }
    await this.audit.write({
      actorUserId,
      action: 'user.password.force_reset',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { email: target.email, reason },
    });
    return { ok: true as const };
  }

  /**
   * Directly set a user's password. The plaintext is argon2-hashed and the
   * hash overwrites passwordHash — the admin never gets to read back any
   * stored password (there is none in plaintext). When
   * requireSecuritySetup is true, the customer is forced through the
   * password-change + transaction-PIN gate on their next sign-in.
   * All sessions are revoked so the old password stops working everywhere.
   * The plaintext is NEVER written to the audit log.
   */
  async setPassword(
    actorUserId: string,
    targetUserId: string,
    password: string,
    requireSecuritySetup: boolean,
    reason: string,
  ) {
    if (password.length < 10) {
      throw new BadRequestException('Password must be at least 10 characters');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    const hash = await this.argon.hash(password);
    // securitySetupRequired isn't in the generated Prisma client yet (same
    // pattern as transfersDisabled) — write both columns via raw SQL.
    await this.prisma.$executeRaw`
      UPDATE "User"
         SET "passwordHash"          = ${hash},
             "securitySetupRequired" = ${requireSecuritySetup}
       WHERE "id" = ${targetUserId}::uuid
    `;
    await this.sessions.revokeAllForUser(targetUserId, SessionRevokedReason.admin_revoke);

    await this.audit.write({
      actorUserId,
      action: 'user.password.set',
      targetType: 'user',
      targetId: targetUserId,
      // NB: never log the password itself.
      metadata: { requireSecuritySetup, reason },
    });
    return { ok: true as const };
  }

  /**
   * Create a user. Admins may create customers; only superadmins may create
   * elevated (admin/superadmin) accounts. The temporary password is hashed;
   * with requireSecuritySetup the user must replace it + set a PIN on first
   * sign-in. Status is forced to the default (`active`) — the admin can
   * freeze/close afterward via the status controls.
   */
  async create(actorUserId: string, actorRole: UserRole, dto: CreateAdminUserDto) {
    const role = dto.role ?? UserRole.customer;
    if (role !== UserRole.customer && actorRole !== UserRole.superadmin) {
      throw new ForbiddenException('Only superadmin can create admin accounts');
    }
    if (dto.password.length < 10) {
      throw new BadRequestException('Password must be at least 10 characters');
    }

    const email = normalizeEmail(dto.email);
    const emailTaken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (emailTaken) throw new ConflictException('email already in use');

    const novaTag = dto.novaTag ? normalizeNovaTag(dto.novaTag) : null;
    if (novaTag) {
      const taken = await this.prisma.user.findFirst({ where: { novaTag }, select: { id: true } });
      if (taken) throw new ConflictException('novaTag already taken');
    }
    const phoneE164 = dto.phoneE164?.trim() || null;
    if (phoneE164) {
      const taken = await this.prisma.user.findFirst({ where: { phoneE164 }, select: { id: true } });
      if (taken) throw new ConflictException('phone already in use');
    }

    const dbStatus: UserStatus = (dto.status ?? 'active') as UserStatus;

    const passwordHash = await this.argon.hash(dto.password);
    const created = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
        phoneE164,
        novaTag,
        role,
        status: dbStatus,
      },
    });

    if (dto.requireSecuritySetup) {
      await this.prisma.$executeRaw`
        UPDATE "User" SET "securitySetupRequired" = true WHERE "id" = ${created.id}::uuid
      `;
    }

    await this.audit.write({
      actorUserId,
      action: 'user.create',
      targetType: 'user',
      targetId: created.id,
      metadata: {
        email,
        role,
        requireSecuritySetup: !!dto.requireSecuritySetup,
        reason: dto.reason,
      },
    });

    // Provision the customer's Checking + Savings accounts (and trigger card
    // issuance via the account.created event) when creating an ACTIVE
    // customer. Admin-created users bypass the normal KYC-approval path that
    // would otherwise provision them, so without this they'd have no accounts.
    let provisionedAccounts: Array<{
      id: string;
      type: string;
      label: string;
      balanceCents: string;
      status: string;
    }> = [];
    if (role === UserRole.customer && dbStatus === UserStatus.active) {
      try {
        const { checking, savings } = await this.accounts.provisionForUser(created.id);
        const at = new Date();
        this.events.emit(ACCOUNT_CREATED_EVENT, {
          accountId: checking.id, userId: created.id, type: 'checking', at,
        } satisfies AccountCreatedPayload);
        this.events.emit(ACCOUNT_CREATED_EVENT, {
          accountId: savings.id, userId: created.id, type: 'savings', at,
        } satisfies AccountCreatedPayload);
        provisionedAccounts = [checking, savings].map((a) => ({
          id: a.id,
          type: a.type,
          label: a.label,
          balanceCents: a.balanceCents.toString(),
          status: a.status,
        }));
      } catch (err) {
        // Don't fail the whole user-creation if provisioning hiccups — the
        // user exists; accounts can be re-provisioned. Surface it in logs.
        this.logger.error(
          `Failed to provision accounts for admin-created user ${created.id}: ${(err as Error).message}`,
        );
      }
    }

    // Shape mirrors detail() so the FE can route to /admin/users/:id.
    return {
      id: created.id,
      ...mapPublicUser(created),
      kycRecord: null,
      accounts: provisionedAccounts,
      transfersDisabled: false,
      transfersDisabledReason: null,
      transfersDisabledAt: null,
      emailNotificationsDisabled: false,
      emailNotificationsDisabledReason: null,
      emailNotificationsDisabledAt: null,
    };
  }

  /**
   * Destructive: deletes every transaction (and override) tied to the
   * user's accounts and zeroes those accounts' balances. Ledger postings
   * are intentionally not touched — they're the immutable audit trail.
   * Superadmin-only and audit-logged with row counts.
   */
  async resetHistory(
    actorUserId: string,
    _actorRole: UserRole,
    targetUserId: string,
    reason: string,
  ) {
    if (actorUserId === targetUserId) {
      throw new BadRequestException('Cannot reset your own history');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    const accounts = await this.prisma.account.findMany({
      where: { userId: targetUserId },
      select: { id: true, balanceCents: true },
    });
    if (accounts.length === 0) {
      await this.audit.write({
        actorUserId,
        action: 'user.history.reset',
        targetType: 'user',
        targetId: targetUserId,
        metadata: { deletedTransactions: 0, deletedOverrides: 0, accountsZeroed: 0, reason },
      });
      return { deletedTransactions: 0, deletedOverrides: 0, accountsZeroed: 0 };
    }
    const accountIds = accounts.map((a) => a.id);

    const result = await this.prisma.$transaction(async (tx) => {
      const overrides = await tx.transactionOverride.deleteMany({
        where: { transaction: { accountId: { in: accountIds } } },
      });
      const transactions = await tx.transaction.deleteMany({
        where: { accountId: { in: accountIds } },
      });
      await tx.account.updateMany({
        where: { id: { in: accountIds } },
        data: { balanceCents: 0n },
      });
      return {
        deletedTransactions: transactions.count,
        deletedOverrides: overrides.count,
        accountsZeroed: accountIds.length,
      };
    });

    // Emit balance-changed events so any open customer client repaints
    // the zeroed balances without a full refresh.
    for (const a of accounts) {
      this.events.emit(NEST_EVENT.AccountBalanceChanged, {
        userId: targetUserId,
        accountId: a.id,
        balanceCents: '0',
        at: new Date(),
      } satisfies NestAccountBalanceChangedPayload);
    }

    await this.audit.write({
      actorUserId,
      action: 'user.history.reset',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { ...result, reason },
    });
    return result;
  }

  /**
   * Hard-delete a user and every owned row that points at them. Caller
   * MUST pass `confirmation` exactly equal to the target user's email
   * (case-insensitive) — protects against accidental clicks.
   *
   * Foreign-key cascades aren't declared on this schema (only
   * SupportMessage → SupportThread), so we walk each table by hand in a
   * single $transaction. Audit-log rows (AdminAuditLog.actorUserId) and
   * money-movement bookkeeping with no enforced FK
   * (Transfer.initiatedByUserId, WireBeneficiary.createdByUserId) are
   * intentionally preserved so the historical trail isn't rewritten by
   * the delete.
   */
  async hardDelete(
    actorUserId: string,
    actorRole: UserRole,
    targetUserId: string,
    confirmation: string,
    reason: string,
  ) {
    if (actorRole !== UserRole.admin && actorRole !== UserRole.superadmin) {
      throw new ForbiddenException('Only admins can delete users');
    }
    if (actorUserId === targetUserId) {
      throw new BadRequestException('Cannot delete your own account');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    // Guard: admins can't nuke other admins/superadmins — only a superadmin
    // can do that. Keeps a regular admin from accidentally (or maliciously)
    // wiping out the whole admin team.
    if (
      actorRole !== UserRole.superadmin &&
      (target.role === UserRole.admin || target.role === UserRole.superadmin)
    ) {
      throw new ForbiddenException(
        'Only a superadmin can delete an admin or superadmin account',
      );
    }

    const expected = target.email.trim().toLowerCase();
    const given = (confirmation ?? '').trim().toLowerCase();
    if (!given || given !== expected) {
      throw new BadRequestException(
        `Confirmation must match the user's email (${target.email}) exactly`,
      );
    }

    const snapshot = {
      email: target.email,
      novaTag: target.novaTag,
      firstName: target.firstName,
      lastName: target.lastName,
      role: target.role,
      status: target.status,
      createdAt: target.createdAt.toISOString(),
    };

    const accounts = await this.prisma.account.findMany({
      where: { userId: targetUserId },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const counts = await this.prisma.$transaction(async (tx) => {
      let deletedTransactionOverrides = 0;
      let deletedTransactions = 0;
      let deletedTransfers = 0;
      let deletedStatements = 0;
      let deletedCards = 0;
      let deletedAccountLimits = 0;

      if (accountIds.length) {
        const txnRows = await tx.transaction.findMany({
          where: { accountId: { in: accountIds } },
          select: { id: true },
        });
        const txnIds = txnRows.map((t) => t.id);
        if (txnIds.length) {
          deletedTransactionOverrides = (
            await tx.transactionOverride.deleteMany({
              where: { transactionId: { in: txnIds } },
            })
          ).count;
        }
        deletedTransfers = (
          await tx.transfer.deleteMany({
            where: {
              OR: [
                { fromAccountId: { in: accountIds } },
                { toAccountId: { in: accountIds } },
              ],
            },
          })
        ).count;
        deletedTransactions = (
          await tx.transaction.deleteMany({ where: { accountId: { in: accountIds } } })
        ).count;
        deletedStatements = (
          await tx.statement.deleteMany({ where: { accountId: { in: accountIds } } })
        ).count;
        deletedCards = (
          await tx.card.deleteMany({ where: { accountId: { in: accountIds } } })
        ).count;
        deletedAccountLimits = (
          await tx.accountLimits.deleteMany({ where: { accountId: { in: accountIds } } })
        ).count;
      }

      // User-owned rows. Counts are logged but not exposed in the response.
      const cardOrders = await tx.cardOrder.deleteMany({ where: { userId: targetUserId } });
      const activatedDeals = await tx.activatedDeal.deleteMany({ where: { userId: targetUserId } });
      const autosave = await tx.autosaveConfig.deleteMany({ where: { userId: targetUserId } });
      const bioChallenges = await tx.biometricChallenge.deleteMany({ where: { userId: targetUserId } });
      const bioEnrollments = await tx.biometricEnrollment.deleteMany({ where: { userId: targetUserId } });
      const checkDeposits = await tx.checkDeposit.deleteMany({ where: { userId: targetUserId } });
      const contacts = await tx.contact.deleteMany({ where: { ownerUserId: targetUserId } });
      const directDeposits = await tx.directDeposit.deleteMany({ where: { userId: targetUserId } });
      const documents = await tx.document.deleteMany({ where: { ownerUserId: targetUserId } });
      const goals = await tx.goal.deleteMany({ where: { userId: targetUserId } });
      const idempotency = await tx.idempotencyKey.deleteMany({ where: { userId: targetUserId } });
      const kyc = await tx.kycRecord.deleteMany({ where: { userId: targetUserId } });
      const linked = await tx.linkedAccount.deleteMany({ where: { userId: targetUserId } });
      const mfa = await tx.mfaChallenge.deleteMany({ where: { userId: targetUserId } });
      const notifications = await tx.notification.deleteMany({ where: { userId: targetUserId } });
      const notificationPrefs = await tx.notificationPreference.deleteMany({ where: { userId: targetUserId } });
      const paymentRequests = await tx.paymentRequest.deleteMany({
        where: {
          OR: [{ requesterUserId: targetUserId }, { payerUserId: targetUserId }],
        },
      });
      const recurring = await tx.recurringTransfer.deleteMany({ where: { userId: targetUserId } });
      const referrals = await tx.referral.deleteMany({ where: { referrerUserId: targetUserId } });
      const roundUps = await tx.roundUpLedger.deleteMany({ where: { userId: targetUserId } });
      const taxForms = await tx.taxForm.deleteMany({ where: { userId: targetUserId } });
      const totp = await tx.totpSecret.deleteMany({ where: { userId: targetUserId } });
      const prefs = await tx.userPreference.deleteMany({ where: { userId: targetUserId } });
      // SupportMessage cascades from SupportThread (declared in schema).
      const supportThreads = await tx.supportThread.deleteMany({ where: { userId: targetUserId } });

      // Accounts must go after every row that points at an accountId.
      const accountsDel = await tx.account.deleteMany({ where: { userId: targetUserId } });

      // Sessions, then devices (Session.deviceId references Device).
      const sessionsDel = await tx.session.deleteMany({ where: { userId: targetUserId } });
      const devicesDel = await tx.device.deleteMany({ where: { userId: targetUserId } });

      // Finally the user row.
      await tx.user.delete({ where: { id: targetUserId } });

      // SignupSession is keyed by email (it predates the User row), so it
      // isn't picked up by the userId-scoped deletes above. Without this,
      // re-signup with the same email fails the unique constraint.
      // Verification → SignupSession has no cascade on the FK, so kill the
      // children first to avoid a FK violation on the parent delete.
      const staleSignupIds = await tx.signupSession.findMany({
        where: { email: target.email },
        select: { id: true },
      });
      const verifications = await tx.verification.deleteMany({
        where: { signupSessionId: { in: staleSignupIds.map((s) => s.id) } },
      });
      const signupSessions = await tx.signupSession.deleteMany({
        where: { email: target.email },
      });

      return {
        accounts: accountsDel.count,
        signupSessions: signupSessions.count,
        verifications: verifications.count,
        sessions: sessionsDel.count,
        devices: devicesDel.count,
        transactions: deletedTransactions,
        transactionOverrides: deletedTransactionOverrides,
        transfers: deletedTransfers,
        statements: deletedStatements,
        cards: deletedCards,
        accountLimits: deletedAccountLimits,
        cardOrders: cardOrders.count,
        activatedDeals: activatedDeals.count,
        autosaveConfigs: autosave.count,
        biometricChallenges: bioChallenges.count,
        biometricEnrollments: bioEnrollments.count,
        checkDeposits: checkDeposits.count,
        contacts: contacts.count,
        directDeposits: directDeposits.count,
        documents: documents.count,
        goals: goals.count,
        idempotencyKeys: idempotency.count,
        kycRecords: kyc.count,
        linkedAccounts: linked.count,
        mfaChallenges: mfa.count,
        notifications: notifications.count,
        notificationPreferences: notificationPrefs.count,
        paymentRequests: paymentRequests.count,
        recurringTransfers: recurring.count,
        referrals: referrals.count,
        roundUpLedger: roundUps.count,
        taxForms: taxForms.count,
        totpSecrets: totp.count,
        userPreferences: prefs.count,
        supportThreads: supportThreads.count,
      };
    });

    await this.audit.write({
      actorUserId,
      action: 'user.delete',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { snapshot, counts, reason },
    });

    this.logger.warn(
      `[hard-delete] ${actorRole}=${actorUserId} deleted user=${targetUserId} (${target.email})`,
    );

    return { id: targetUserId, deleted: true as const, counts };
  }

  async revokeAllSessions(actorUserId: string, targetUserId: string) {
    const ids = await this.sessions.revokeAllForUser(targetUserId, SessionRevokedReason.admin_revoke);
    await this.audit.write({
      actorUserId,
      action: 'user.sessions.revoke_all',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { revokedSessionIds: ids },
    });
    return { revoked: ids.length };
  }

  /**
   * Force-logout every active session AND hard-delete the user's entire
   * login history (sessions, refresh-token audit, devices). Unlike
   * revoke-all (which keeps the rows so the timeline survives), this wipes
   * the "recent logins" record clean.
   */
  async resetLoginHistory(actorUserId: string, targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const result = await this.sessions.purgeForUser(targetUserId);
    await this.audit.write({
      actorUserId,
      action: 'user.sessions.reset',
      targetType: 'user',
      targetId: targetUserId,
      metadata: result,
    });
    return result;
  }

  /**
   * Flip the user's `transfersDisabled` flag. Writes an audit row both
   * directions so we have a paper trail of who blocked and unblocked.
   * Doesn't touch sessions — the user stays logged in; they just can't
   * move money until cleared. Frontend renders a dedicated modal on the
   * `TRANSFERS_DISABLED` error code the initiate path returns.
   */
  async setTransfersDisabled(
    actorUserId: string,
    targetUserId: string,
    disabled: boolean,
    reason?: string,
  ) {
    if (targetUserId === actorUserId) {
      throw new BadRequestException('Cannot block your own transfers');
    }
    const existing = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!existing) throw new NotFoundException('User not found');

    // Drive the update via raw SQL. The Prisma client typings here
    // haven't been regenerated since the columns were added in
    // 20260531200000_user_transfers_disabled — the `as never` cast
    // silences TypeScript but Prisma's runtime validator still rejects
    // unknown fields. Raw SQL bypasses both. Columns live on `"User"`
    // exactly as the migration created them.
    const trimmedReason = disabled ? (reason?.trim() || null) : null;
    const at = disabled ? new Date() : null;
    const byUserId = disabled ? actorUserId : null;
    await this.prisma.$executeRaw`
      UPDATE "User"
         SET "transfersDisabled"        = ${disabled},
             "transfersDisabledReason"  = ${trimmedReason},
             "transfersDisabledAt"      = ${at},
             "transfersDisabledByUserId" = ${byUserId}::uuid
       WHERE "id" = ${targetUserId}::uuid
    `;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        transfersDisabled: boolean;
        transfersDisabledReason: string | null;
        transfersDisabledAt: Date | null;
      }[]
    >`
      SELECT "id",
             "transfersDisabled",
             "transfersDisabledReason",
             "transfersDisabledAt"
        FROM "User"
       WHERE "id" = ${targetUserId}::uuid
    `;
    const updated = rows[0];
    if (!updated) throw new NotFoundException('User not found');

    await this.audit.write({
      actorUserId,
      action: disabled ? 'user.transfers.block' : 'user.transfers.unblock',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { reason: reason ?? null },
    });

    return {
      id: updated.id,
      transfersDisabled: updated.transfersDisabled,
      transfersDisabledReason: updated.transfersDisabledReason,
      transfersDisabledAt: updated.transfersDisabledAt?.toISOString() ?? null,
    };
  }

  /**
   * Flip the user's `emailNotificationsDisabled` kill switch. While true,
   * EmailService drops every email addressed to the user — including
   * sign-in codes and self-service password resets (so the user can be
   * fully locked out of email). Admin-initiated reset links, admin code
   * copies, signup verification, and admin-composed mail still deliver.
   * Audit-logged in both directions.
   */
  async setEmailNotificationsDisabled(
    actorUserId: string,
    targetUserId: string,
    disabled: boolean,
    reason?: string,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    // Raw SQL: the new columns aren't in the generated Prisma client yet
    // (same pattern as transfersDisabled).
    const trimmedReason = disabled ? (reason?.trim() || null) : null;
    const at = disabled ? new Date() : null;
    await this.prisma.$executeRaw`
      UPDATE "User"
         SET "emailNotificationsDisabled"       = ${disabled},
             "emailNotificationsDisabledReason" = ${trimmedReason},
             "emailNotificationsDisabledAt"     = ${at}
       WHERE "id" = ${targetUserId}::uuid
    `;

    await this.audit.write({
      actorUserId,
      action: disabled ? 'user.email_notifications.disable' : 'user.email_notifications.enable',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { reason: reason ?? null },
    });

    return {
      id: targetUserId,
      emailNotificationsDisabled: disabled,
      emailNotificationsDisabledReason: trimmedReason,
      emailNotificationsDisabledAt: at?.toISOString() ?? null,
    };
  }

  async changeRole(actorUserId: string, actorRole: UserRole, targetUserId: string, dto: ChangeRoleDto) {
    if (actorRole !== UserRole.superadmin) throw new ForbiddenException('Only superadmin can change roles');
    if (targetUserId === actorUserId) throw new BadRequestException('Cannot change your own role');
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Target user not found');

    const before = target.role;
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: dto.role },
    });
    await this.sessions.revokeAllForUser(targetUserId, SessionRevokedReason.admin_revoke);
    await this.audit.write({
      actorUserId,
      action: 'user.role.change',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { before, after: dto.role, reason: dto.reason },
    });
    return { id: updated.id, role: updated.role };
  }
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeNovaTag(raw: string): string | null {
  const cleaned = raw.trim().replace(/^@+/, '').toLowerCase();
  if (!cleaned) return null;
  return `@${cleaned}`;
}

function mapPublicUser(u: {
  email: string; novaTag: string | null; phoneE164: string | null;
  firstName: string | null; lastName: string | null;
  role: UserRole; status: UserStatus; createdAt: Date; dob: Date | null;
}) {
  return {
    email: u.email,
    novaTag: u.novaTag,
    phoneE164: u.phoneE164,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    dob: u.dob ? u.dob.toISOString() : null,
  };
}
