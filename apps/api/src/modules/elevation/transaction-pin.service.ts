import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Argon2Service } from '../crypto/argon2.service';
import { ElevationScope, ElevationService } from './elevation.service';

const PIN_RE = /^\d{4,6}$/;

// Per-user attempt counter. In-memory is fine for a single-node demo;
// production would back this with Redis + an explicit lockout window.
type Attempts = { count: number; lockedUntil: number | null };
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// The Prisma client types are regenerated post-migration; until the
// running dev process restarts, `user.transactionPinHash` isn't yet on
// the generated User type. Use raw access through the same Prisma
// instance to stay agnostic to client-generation timing.
type PinRow = { transactionPinHash: string | null };

@Injectable()
export class TransactionPinService {
  private readonly logger = new Logger(TransactionPinService.name);
  private readonly attempts = new Map<string, Attempts>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: Argon2Service,
    private readonly elevation: ElevationService,
  ) {}

  /** Whether the user has a PIN configured. */
  async hasPin(userId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<PinRow[]>`
      SELECT "transactionPinHash" FROM "User" WHERE "id" = ${userId}::uuid LIMIT 1
    `;
    return !!rows[0]?.transactionPinHash;
  }

  /**
   * Set or change the PIN. First-time setup just requires the session.
   * Changing an existing PIN requires the current PIN (or password as
   * recovery fallback).
   */
  async setPin(args: {
    userId: string;
    newPin: string;
    currentPin?: string;
    currentPassword?: string;
  }): Promise<void> {
    if (!PIN_RE.test(args.newPin)) {
      throw new BadRequestException('PIN must be 4–6 digits');
    }
    if (looksWeak(args.newPin)) {
      throw new BadRequestException('PIN is too predictable — pick another');
    }

    const rows = await this.prisma.$queryRaw<
      { passwordHash: string; transactionPinHash: string | null }[]
    >`
      SELECT "passwordHash", "transactionPinHash"
      FROM "User" WHERE "id" = ${args.userId}::uuid LIMIT 1
    `;
    const user = rows[0];
    if (!user) throw new UnauthorizedException('User not found');

    if (user.transactionPinHash) {
      // Changing — prove possession of the old PIN, OR fall back to password.
      if (args.currentPin) {
        const ok = await this.argon.verify(
          user.transactionPinHash,
          args.currentPin,
        );
        if (!ok) throw new ForbiddenException('Current PIN is incorrect');
      } else if (args.currentPassword) {
        const ok = await this.argon.verify(
          user.passwordHash,
          args.currentPassword,
        );
        if (!ok) throw new ForbiddenException('Current password is incorrect');
      } else {
        throw new BadRequestException(
          'Provide your current PIN or password to change it',
        );
      }
    }

    const hash = await this.argon.hash(args.newPin);
    // Setting the PIN is the final step of the first-login security gate,
    // so clear the flag here — once a PIN exists the user has completed
    // password change + PIN setup and the customer app stops gating them.
    await this.prisma.$executeRaw`
      UPDATE "User"
         SET "transactionPinHash"    = ${hash},
             "securitySetupRequired" = false
      WHERE "id" = ${args.userId}::uuid
    `;
    this.attempts.delete(args.userId);
  }

  /**
   * Verify the PIN. On success returns a short-lived elevation token
   * scoped to the requested capability (defaults to `transfer:authorize`
   * for back-compat). Backs off after MAX_ATTEMPTS to thwart casual
   * brute force.
   */
  async verifyPin(
    userId: string,
    pin: string,
    scope: ElevationScope = 'transfer:authorize',
  ): Promise<string> {
    if (!PIN_RE.test(pin)) {
      // Client-side validation issue — don't burn an attempt.
      throw new BadRequestException('PIN must be 4–6 digits');
    }

    const attempts =
      this.attempts.get(userId) ?? { count: 0, lockedUntil: null };
    if (attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
      const minsLeft = Math.ceil(
        (attempts.lockedUntil - Date.now()) / 60_000,
      );
      throw new HttpException(
        `Too many attempts. Try again in ${minsLeft} min.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const rows = await this.prisma.$queryRaw<PinRow[]>`
      SELECT "transactionPinHash" FROM "User" WHERE "id" = ${userId}::uuid LIMIT 1
    `;
    const hash = rows[0]?.transactionPinHash;
    if (!hash) throw new BadRequestException('PIN not set');

    const ok = await this.argon.verify(hash, pin);
    if (!ok) {
      attempts.count += 1;
      if (attempts.count >= MAX_ATTEMPTS) {
        attempts.lockedUntil = Date.now() + LOCKOUT_MS;
        attempts.count = 0;
      }
      this.attempts.set(userId, attempts);
      throw new UnauthorizedException('Wrong PIN');
    }

    this.attempts.delete(userId);
    return this.elevation.signElevation(userId, scope);
  }
}

/** Reject the most obvious weak PINs. */
function looksWeak(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // all same digit
  const ascending = pin
    .split('')
    .every((d, i, arr) => i === 0 || +d === +arr[i - 1] + 1);
  const descending = pin
    .split('')
    .every((d, i, arr) => i === 0 || +d === +arr[i - 1] - 1);
  return ascending || descending;
}
