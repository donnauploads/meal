// CLI: approve a pending KycRecord for a user, triggering account provisioning.
// Usage:
//   pnpm --filter api exec ts-node src/scripts/approve-kyc.ts --email user@example.com
//   pnpm --filter api exec ts-node src/scripts/approve-kyc.ts --userId <uuid>
//
// Real admin UI lands in Stage 14; this is the Stage 3 stub.

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from '../modules/kyc/kyc.service';

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const email = parseArg('--email');
  const userId = parseArg('--userId');
  if (!email && !userId) {
    console.error('Provide --email <addr> or --userId <uuid>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const kyc = app.get(KycService);

  const user = email
    ? await prisma.user.findUnique({ where: { email } })
    : await prisma.user.findUnique({ where: { id: userId! } });
  if (!user) {
    console.error('User not found');
    await app.close();
    process.exit(1);
  }
  const record = await prisma.kycRecord.findUnique({ where: { userId: user.id } });
  if (!record) {
    console.error('No KycRecord for user; signup may not be complete');
    await app.close();
    process.exit(1);
  }

  const reviewer = await prisma.user.findFirst({ where: { role: { in: ['admin', 'superadmin'] } } });
  const approved = await kyc.approve(record.id, reviewer?.id ?? user.id);
  console.log(`Approved KYC ${approved.id} for ${user.email}. kyc.approved event emitted.`);

  // Give the listener a moment to provision accounts.
  await new Promise((r) => setTimeout(r, 500));
  const accounts = await prisma.account.findMany({ where: { userId: user.id } });
  console.log(`User now has ${accounts.length} account(s):`);
  for (const a of accounts) {
    console.log(` - ${a.type} ${a.label} (${a.id}) balance=${a.balanceCents.toString()}`);
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
