import { PrismaClient } from '@prisma/client';
import { seedMerchants } from '../modules/merchants/merchants.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    const n = await seedMerchants(prisma);
    console.log(`Upserted ${n} merchants.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
