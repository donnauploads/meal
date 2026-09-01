// CLI: flip DirectDeposit.active=true for a user (demo helper).
//   pnpm --filter api exec ts-node src/scripts/activate-direct-deposit.ts --email user@example.com

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { DirectDepositService } from '../modules/direct-deposit/direct-deposit.service';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--email');
  const userId = arg('--userId');
  if (!email && !userId) {
    console.error('Provide --email or --userId');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const dd = app.get(DirectDepositService);
  const user = email
    ? await prisma.user.findUnique({ where: { email } })
    : await prisma.user.findUnique({ where: { id: userId! } });
  if (!user) {
    console.error('User not found');
    await app.close();
    process.exit(1);
  }
  const row = await dd.forceActivate(user.id);
  console.log(`Direct deposit active=${row.active} for ${user.email} (activatedAt=${row.activatedAt?.toISOString()})`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
