/**
 * Promote an abandoned SignupSession into a real User + approved KycRecord.
 *
 * Useful for demos when a user got mid-way through signup but won't finish the
 * remaining steps. Fills in any missing fields (address, password, SSN) with
 * placeholder values so the User row can be created, then triggers the same
 * `kyc.approved` event as `approve-kyc.ts` (provisions accounts + issues card).
 *
 * Usage:
 *   pnpm --filter api exec ts-node src/scripts/promote-signup.ts --email user@example.com [--password Password123!]
 *   pnpm --filter api exec ts-node src/scripts/promote-signup.ts --signupId <uuid>
 *
 * If --password isn't given, defaults to "Password123!".
 */

import { NestFactory } from '@nestjs/core';
import { KycStatus, SignupStage } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from '../modules/kyc/kyc.service';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--email');
  const signupId = arg('--signupId');
  const newPassword = arg('--password') ?? 'Password123!';
  if (!email && !signupId) {
    console.error('Provide --email or --signupId');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const kyc = app.get(KycService);

  const signup = email
    ? await prisma.signupSession.findUnique({ where: { email } })
    : await prisma.signupSession.findUnique({ where: { id: signupId! } });

  if (!signup) {
    console.error('No SignupSession found for that lookup.');
    await app.close();
    process.exit(1);
  }
  if (signup.resolvedUserId) {
    console.log(`Signup ${signup.id} already resolved to user ${signup.resolvedUserId}.`);
    await app.close();
    return;
  }

  const finalEmail = signup.email;
  if (!finalEmail) {
    console.error('SignupSession has no email — cannot promote.');
    await app.close();
    process.exit(1);
  }

  const existingUser = await prisma.user.findUnique({ where: { email: finalEmail } });
  if (existingUser) {
    console.error(`A user with email ${finalEmail} already exists (${existingUser.id}).`);
    await app.close();
    process.exit(1);
  }

  const passwordHash = signup.passwordHash ?? (await argon2.hash(newPassword, { type: argon2.argon2id }));
  const dob = signup.dob ?? new Date(Date.UTC(1995, 5, 15));

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: finalEmail,
        passwordHash,
        firstName: signup.firstName ?? 'New',
        lastName: signup.lastName ?? 'User',
        phoneE164: signup.phoneE164,
        dob,
        novaTag: signup.firstName ? `@${signup.firstName.toLowerCase()}_${randomBytes(2).toString('hex')}` : null,
      },
    });
    const kycRecord = await tx.kycRecord.create({
      data: { userId: user.id, status: KycStatus.pending, missingFields: [] },
    });
    await tx.signupSession.update({
      where: { id: signup.id },
      data: { stage: SignupStage.completed, resolvedUserId: user.id },
    });
    return { user, kycRecord };
  });

  console.log(`Created user ${result.user.id} from signup ${signup.id}.`);

  const approved = await kyc.approve(result.kycRecord.id, result.user.id);
  console.log(`Approved KYC ${approved.id}. Accounts + card provisioning fired via events.`);
  console.log(`\nLogin credentials:`);
  console.log(`  email:    ${result.user.email}`);
  console.log(`  password: ${signup.passwordHash ? '<unchanged from signup>' : newPassword}`);
  console.log(`  userId:   ${result.user.id}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
