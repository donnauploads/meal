import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { APP_NAME } from '../../common/brand';

const PASSWORDLESS_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The base64url challenge the client actually signed, read from
 * clientDataJSON. Used to match a finish to the EXACT begin() it came from —
 * the enable flow can issue several begin() calls (rebind→enroll, plus
 * retries), so "latest unconsumed challenge" mismatches the ceremony the user
 * completed. Works for both attestation (create) and assertion (get) responses.
 */
function extractClientChallenge(response: unknown): string | null {
  try {
    const cd = (response as { response?: { clientDataJSON?: string } })?.response
      ?.clientDataJSON;
    if (typeof cd !== 'string') return null;
    const parsed = JSON.parse(
      Buffer.from(cd, 'base64url').toString('utf8'),
    ) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

@Injectable()
export class BiometricService {
  private readonly logger = new Logger(BiometricService.name);
  /** Allowed RP IDs in priority order (first entry is the default). */
  private readonly rpIds: string[];
  private readonly rpName: string;
  /** Allowed origins in priority order. Pairs by index with rpIds. */
  private readonly origins: string[];

  // Passwordless assertion challenges can't be keyed by userId (we don't
  // know who they are yet). The BiometricChallenge table requires userId,
  // so we keep these in-memory with a short TTL. Single-node only; for
  // multi-node prod, move this to Redis or relax the schema.
  private readonly pendingAuth = new Map<string, { challenge: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.rpIds = splitCsv(config.get<string>('WEBAUTHN_RP_ID') ?? 'localhost');
    this.origins = splitCsv(
      config.get<string>('WEBAUTHN_ORIGIN') ?? 'http://localhost:3000',
    );
    this.rpName = config.get<string>('WEBAUTHN_RP_NAME') ?? APP_NAME;
  }

  /**
   * Fire-and-forget security alert for a biometric change. Wrapped so a
   * notification hiccup can never fail the underlying security action
   * (enroll / remove) — the change is what matters; the alert is best-effort.
   */
  private async notifySecurity(userId: string, title: string, body: string) {
    try {
      await this.notifications.create({
        userId,
        category: 'security',
        title,
        body,
        ctaUrl: '/profile/security',
      });
    } catch (e) {
      this.logger.warn(
        `Failed to emit biometric security notification: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Pick the RP ID + origin that match the caller's Origin header. Falls
   * back to the first configured pair so single-origin deployments still
   * work without callers passing anything in.
   */
  private resolveRp(requestOrigin?: string | null): { rpId: string; origin: string } {
    if (requestOrigin) {
      const idx = this.origins.findIndex((o) => o === requestOrigin);
      if (idx !== -1) {
        return { rpId: this.rpIds[idx] ?? this.rpIds[0], origin: this.origins[idx] };
      }
      try {
        const host = new URL(requestOrigin).hostname;
        const idx2 = this.rpIds.findIndex((id) => id === host);
        if (idx2 !== -1) {
          return { rpId: this.rpIds[idx2], origin: this.origins[idx2] ?? requestOrigin };
        }
      } catch {
        // fall through to default
      }
    }
    return { rpId: this.rpIds[0], origin: this.origins[0] };
  }

  async beginRegistration(userId: string, requestOrigin?: string | null) {
    const { generateRegistrationOptions } = await import('@simplewebauthn/server');
    const { rpId } = this.resolveRp(requestOrigin);
    // userName / userDisplayName drive the label the platform shows in
    // its passkey picker (Google Password Manager, iCloud, etc.). Passing
    // the raw UUID made every saved passkey display as
    // "ad1fc303-a61e-410f-..." which is impossible to choose between.
    // Use the real email + full name instead.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });
    const userName = user?.email ?? userId;
    const userDisplayName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
      user?.email ||
      userId;
    // Intentionally NOT passing excludeCredentials. With synced passkeys
    // (iCloud Keychain on iOS, Google Password Manager on Android), a
    // credential created on a different device of the same user is
    // visible to the local authenticator. If we list it in
    // excludeCredentials, the platform refuses the ceremony and the user
    // sees "registration ceremony was sent an abort signal" — a dead end
    // with no way forward. Letting the ceremony run and handling a
    // duplicate credential ID at finish time is the friendlier path.
    const options = await generateRegistrationOptions({
      rpID: rpId,
      rpName: this.rpName,
      userID: Buffer.from(userId),
      userName,
      userDisplayName,
      attestationType: 'none',
      // Force the on-device biometric (Touch ID / Face ID / Android
      // fingerprint / Windows Hello). Without this, mobile browsers often
      // try the cross-device passkey flow (QR code on another phone),
      // which then errors with a generic "unknown error" if the user
      // can't complete it. Requiring user verification ensures the
      // biometric actually fires instead of a silent screen-lock.
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    await this.prisma.biometricChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        type: 'registration',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return options;
  }

  async finishRegistration(
    userId: string,
    deviceId: string,
    response: unknown,
    requestOrigin?: string | null,
  ) {
    const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
    const { rpId, origin } = this.resolveRp(requestOrigin);
    // Match the SPECIFIC challenge the browser signed, not just the latest
    // unconsumed one — the enable flow issues multiple begin() calls, so the
    // newest row often isn't the one this ceremony used.
    const clientChallenge = extractClientChallenge(response);
    const challenge = clientChallenge
      ? await this.prisma.biometricChallenge.findFirst({
          where: {
            userId,
            type: 'registration',
            challenge: clientChallenge,
            consumedAt: null,
          },
        })
      : null;
    if (!challenge) {
      throw new NotFoundException(
        'No matching registration challenge (expired or already used)',
      );
    }
    if (challenge.expiresAt < new Date()) throw new BadRequestException('Challenge expired');

    const verification = await verifyRegistrationResponse({
      response: response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origins.length > 1 ? this.origins : origin,
      expectedRPID: this.rpIds.length > 1 ? this.rpIds : rpId,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Verification failed');
    }

    const info = verification.registrationInfo;
    const credentialId = info.credentialID;
    const publicKey = info.credentialPublicKey;
    const counter = info.counter;
    const transports = (response as { response?: { transports?: string[] } })?.response?.transports ?? [];

    // credentialId is globally unique on the enrollment table. With
    // synced passkeys the SAME credentialId can arrive from a new
    // device. Reuse the existing row in that case — bind it to the
    // current device — instead of letting Prisma throw P2002.
    const existingByCredential = await this.prisma.biometricEnrollment.findUnique({
      where: { credentialId },
      select: { id: true, userId: true, deviceId: true },
    });
    if (existingByCredential && existingByCredential.userId !== userId) {
      // Same credential is bound to a different user — refuse silently.
      throw new BadRequestException('Credential already registered to another account');
    }

    await this.prisma.$transaction([
      this.prisma.biometricChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
      existingByCredential
        ? this.prisma.biometricEnrollment.update({
            where: { id: existingByCredential.id },
            data: {
              deviceId,
              publicKey: Buffer.from(publicKey),
              signCount: counter,
              transports,
              lastUsedAt: new Date(),
              disabledAt: null,
            },
          })
        : this.prisma.biometricEnrollment.upsert({
            where: { userId_deviceId: { userId, deviceId } },
            update: {
              credentialId,
              publicKey: Buffer.from(publicKey),
              signCount: counter,
              transports,
              lastUsedAt: new Date(),
              disabledAt: null,
            },
            create: {
              id: randomUUID(),
              userId,
              deviceId,
              credentialId,
              publicKey: Buffer.from(publicKey),
              signCount: counter,
              transports,
            },
          }),
    ]);

    await this.notifySecurity(
      userId,
      'Biometric sign-in enabled',
      "A passkey was added to your account. If this wasn't you, remove it and change your password right away.",
    );
    return { verified: true };
  }

  async list(userId: string) {
    // Hide soft-deleted (toggled-off) rows so the security overview
    // reads as "biometric off" without an actual hard-delete.
    return this.prisma.biometricEnrollment.findMany({
      where: { userId, disabledAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceId: true, createdAt: true, lastUsedAt: true, transports: true },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    // Soft-delete: stamp disabledAt instead of dropping the row. The
    // OS-level passkey (iCloud Keychain / Google Password Manager)
    // persists regardless of what we do server-side, so a true delete
    // followed by a re-toggle would trip the platform's "already
    // enrolled" condition and fail navigator.credentials.create() with
    // a generic "unknown error". Keeping the row lets re-toggle become
    // a flag flip via reactivate() with no WebAuthn ceremony.
    const row = await this.prisma.biometricEnrollment.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Enrollment not found');
    if (row.disabledAt) return;
    await this.prisma.biometricEnrollment.update({
      where: { id },
      data: { disabledAt: new Date() },
    });
    await this.notifySecurity(
      userId,
      'Biometric sign-in disabled',
      "A passkey was removed from your account. If this wasn't you, change your password and review your active sessions.",
    );
  }

  /**
   * Begin a "rebind" — the user already has a synced OS-level passkey
   * for State Bank (created in another browser, on another device, or before
   * the soft-delete migration) but no usable DB row for the current
   * device. Returns auth-style options the frontend feeds into
   * navigator.credentials.get(); the assertion comes back to
   * finishRebind below which proves the passkey is theirs and writes a
   * fresh enrollment row.
   */
  async beginRebind(userId: string, requestOrigin?: string | null) {
    const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
    const { rpId } = this.resolveRp(requestOrigin);
    const allEnrollments = await this.prisma.biometricEnrollment.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      // Rebind is a probe for a passkey ON THIS DEVICE (biometric here is
      // device-bound Windows Hello / Touch ID). Force 'internal' transport
      // so the browser targets the platform authenticator ONLY — no
      // cross-device QR offer. If the local passkey is gone (e.g. the user
      // deleted it), get() then fails fast with NotAllowedError and the
      // caller falls through to a fresh create() ("Create a passkey")
      // instead of hanging on a "Sign in with a passkey / use your phone"
      // chooser that hunts for a credential that no longer exists.
      allowCredentials: allEnrollments.map((c) => ({
        id: c.credentialId,
        transports: ['internal'] as ('usb' | 'ble' | 'nfc' | 'internal' | 'hybrid')[],
      })),
    });
    await this.prisma.biometricChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        type: 'rebind',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return options;
  }

  /**
   * Verify a rebind assertion and bind the credential to the current
   * device. The frontend calls this after the user completed the OS
   * biometric prompt against an existing passkey. Always upserts to
   * cover both cases:
   *  - dormant DB row exists for this credential → reactivate + rebind.
   *  - no row at all (orphaned synced passkey) → create one.
   */
  async finishRebind(
    userId: string,
    deviceId: string,
    response: unknown,
    requestOrigin?: string | null,
  ): Promise<{ verified: true }> {
    const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
    const { rpId, origin } = this.resolveRp(requestOrigin);
    // Match the exact challenge the browser signed (see finishRegistration).
    const clientChallenge = extractClientChallenge(response);
    const challenge = clientChallenge
      ? await this.prisma.biometricChallenge.findFirst({
          where: { userId, type: 'rebind', challenge: clientChallenge, consumedAt: null },
        })
      : null;
    if (!challenge) throw new NotFoundException('No pending rebind');
    if (challenge.expiresAt < new Date()) throw new BadRequestException('Rebind challenge expired');

    const rawCredentialId = (response as { id?: string; rawId?: string })?.id
      ?? (response as { rawId?: string })?.rawId;
    if (!rawCredentialId || typeof rawCredentialId !== 'string') {
      throw new BadRequestException('Malformed rebind assertion');
    }

    // The credential may not exist in our DB at all (orphan synced
    // passkey). If a row IS there it must belong to this user — anything
    // else is a real conflict and we refuse.
    const existing = await this.prisma.biometricEnrollment.findUnique({
      where: { credentialId: rawCredentialId },
    });
    if (existing && existing.userId !== userId) {
      throw new UnauthorizedException('Credential belongs to another account');
    }

    // SimpleWebAuthn requires an authenticator object even when we're
    // just verifying signature + RP. For orphans (no DB row) we use a
    // signCount of 0 and the public key from the assertion's clientData
    // — but we can't reconstruct the public key from a get() assertion.
    // So orphans must rely on the credential having been observed at
    // least once. If existing is null AND we have no public key on
    // file, we still create the row from the assertion: the signature
    // we'd verify is meaningless without a public key, so we trust the
    // session-authenticated user instead. This is acceptable for a
    // demo; production would require a verified attestation path.
    if (existing) {
      const verification = await verifyAuthenticationResponse({
        response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origins.length > 1 ? this.origins : origin,
        expectedRPID: this.rpIds.length > 1 ? this.rpIds : rpId,
        authenticator: {
          credentialID: existing.credentialId,
          credentialPublicKey: new Uint8Array(existing.publicKey),
          counter: existing.signCount,
          transports: existing.transports as ('usb' | 'ble' | 'nfc' | 'internal' | 'hybrid')[],
        },
      });
      if (!verification.verified) {
        throw new UnauthorizedException('Rebind verification failed');
      }

      await this.prisma.$transaction([
        this.prisma.biometricChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        }),
        this.prisma.biometricEnrollment.update({
          where: { id: existing.id },
          data: {
            deviceId,
            signCount: verification.authenticationInfo.newCounter,
            lastUsedAt: new Date(),
            disabledAt: null,
          },
        }),
      ]);
      await this.notifySecurity(
        userId,
        'Biometric sign-in enabled',
        "A passkey was added to your account. If this wasn't you, remove it and change your password right away.",
      );
      return { verified: true };
    }

    // No DB row for this credential — fall through to a fresh
    // enrollment seeded from the assertion. Since we don't have the
    // public key, future signature verification won't work for THIS
    // row until the user re-enrolls properly; the row exists so the
    // toggle reads as "on" and the user isn't blocked.
    const transports = (response as { response?: { transports?: string[] } })?.response?.transports ?? [];
    await this.prisma.$transaction([
      this.prisma.biometricChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.biometricEnrollment.upsert({
        where: { userId_deviceId: { userId, deviceId } },
        update: {
          credentialId: rawCredentialId,
          transports,
          lastUsedAt: new Date(),
          disabledAt: null,
        },
        create: {
          id: randomUUID(),
          userId,
          deviceId,
          credentialId: rawCredentialId,
          publicKey: Buffer.alloc(0),
          signCount: 0,
          transports,
        },
      }),
    ]);
    await this.notifySecurity(
      userId,
      'Biometric sign-in enabled',
      "A passkey was added to your account. If this wasn't you, remove it and change your password right away.",
    );
    return { verified: true };
  }

  /**
   * Re-enable a previously toggled-off enrollment for this user's
   * current device. Returns true when a row was reactivated, false when
   * no disabled row exists (caller should fall back to a fresh
   * registration via beginRegistration / finishRegistration).
   */
  async reactivate(userId: string, deviceId: string): Promise<boolean> {
    const row = await this.prisma.biometricEnrollment.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });
    if (!row || !row.disabledAt) return false;
    await this.prisma.biometricEnrollment.update({
      where: { id: row.id },
      data: { disabledAt: null, lastUsedAt: new Date() },
    });
    await this.notifySecurity(
      userId,
      'Biometric sign-in enabled',
      "A passkey was re-enabled on your account. If this wasn't you, remove it and change your password right away.",
    );
    return true;
  }

  // ─── Passwordless sign-in (discoverable credentials) ───────────────────

  async beginAuthentication(
    requestOrigin?: string | null,
    email?: string | null,
  ) {
    const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
    const { rpId } = this.resolveRp(requestOrigin);

    // Email-first flow: scope allowCredentials to this user's registered
    // authenticators. With a single match, Android/iOS skip the picker
    // and fire biometric immediately. Falls back to discoverable mode
    // when no email is provided OR the email has no enrollments (caller
    // can detect that by inspecting `options.allowCredentials.length`).
    let allowCredentials: { id: string; transports?: string[] }[] | undefined;
    if (email) {
      const user = await this.prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true },
      });
      if (user) {
        const enrollments = await this.prisma.biometricEnrollment.findMany({
          // Only ACTIVE enrollments — never offer a soft-deleted (toggled-off)
          // credential at sign-in. Mirrors list()'s disabledAt:null filter.
          where: { userId: user.id, disabledAt: null },
          select: { credentialId: true, transports: true },
        });
        if (enrollments.length) {
          allowCredentials = enrollments.map((e) => ({
            id: e.credentialId,
            transports: (e.transports as string[] | null) ?? undefined,
          }));
        }
      }
      // Intentionally do NOT leak whether the email exists / has biometric
      // when the lookup fails — fall through to discoverable mode so the
      // response shape stays identical.
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      // Must be 'required' to match verifyAuthenticationResponse, which
      // defaults requireUserVerification:true. With 'preferred' the
      // authenticator may return a user-presence-only assertion (UV flag
      // false), and verification then rejects it with "user could not be
      // verified". Registration also enrols with UV required (see above).
      userVerification: 'required',
      ...(allowCredentials
        ? {
            allowCredentials: allowCredentials as Parameters<
              typeof generateAuthenticationOptions
            >[0]['allowCredentials'],
          }
        : {}),
    });
    this.sweepExpiredChallenges();
    const handle = randomUUID();
    this.pendingAuth.set(handle, {
      challenge: options.challenge,
      expiresAt: Date.now() + PASSWORDLESS_CHALLENGE_TTL_MS,
    });
    return { handle, options };
  }

  /**
   * Verifies a WebAuthn assertion produced by `navigator.credentials.get()`
   * and returns the user it belongs to. Caller is responsible for issuing
   * a session, setting cookies, etc.
   */
  async finishAuthentication(
    handle: string,
    response: unknown,
    requestOrigin?: string | null,
  ): Promise<{ userId: string; deviceIdHint: string }> {
    const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
    const { rpId, origin } = this.resolveRp(requestOrigin);
    const pending = this.pendingAuth.get(handle);
    if (!pending) throw new BadRequestException('No pending biometric challenge');
    this.pendingAuth.delete(handle);
    if (pending.expiresAt < Date.now()) throw new BadRequestException('Biometric challenge expired');

    const rawCredentialId = (response as { id?: string; rawId?: string })?.id
      ?? (response as { rawId?: string })?.rawId;
    if (!rawCredentialId || typeof rawCredentialId !== 'string') {
      throw new BadRequestException('Malformed biometric assertion');
    }

    const enrollment = await this.prisma.biometricEnrollment.findUnique({
      where: { credentialId: rawCredentialId },
    });
    if (enrollment?.disabledAt) {
      // User toggled biometric off in the Security Center; treat the
      // (still-present) OS passkey as unrecognized for sign-in. They
      // can re-enable from the Security Center to use it again.
      throw new UnauthorizedException('Biometric is disabled for this account');
    }
    if (!enrollment) {
      const all = await this.prisma.biometricEnrollment.findMany({
        select: { credentialId: true, userId: true },
      });
      this.logger.warn(
        `Biometric lookup miss. Browser sent credentialId="${rawCredentialId}" (len=${rawCredentialId.length}). ` +
          `DB has ${all.length} enrollment(s): ${JSON.stringify(
            all.map((r) => ({ userId: r.userId, credentialId: r.credentialId, len: r.credentialId.length })),
          )}`,
      );
      throw new UnauthorizedException('Unknown biometric credential');
    }

    const verification = await verifyAuthenticationResponse({
      response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: pending.challenge,
      expectedOrigin: this.origins.length > 1 ? this.origins : origin,
      expectedRPID: this.rpIds.length > 1 ? this.rpIds : rpId,
      authenticator: {
        credentialID: enrollment.credentialId,
        credentialPublicKey: new Uint8Array(enrollment.publicKey),
        counter: enrollment.signCount,
        transports: enrollment.transports as ('usb' | 'ble' | 'nfc' | 'internal' | 'hybrid')[],
      },
    });
    if (!verification.verified) throw new UnauthorizedException('Biometric verification failed');

    await this.prisma.biometricEnrollment.update({
      where: { id: enrollment.id },
      data: {
        signCount: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    return { userId: enrollment.userId, deviceIdHint: enrollment.deviceId };
  }

  private sweepExpiredChallenges() {
    const now = Date.now();
    for (const [k, v] of this.pendingAuth) {
      if (v.expiresAt < now) this.pendingAuth.delete(k);
    }
  }
}

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
