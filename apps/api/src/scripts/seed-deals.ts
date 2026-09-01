import { PrismaClient } from '@prisma/client';

const DEALS = [
  { title: '5% back at Starbucks', merchantName: 'Starbucks', cashbackBps: 500, description: 'Activate and earn 5% back on Starbucks purchases this month.' },
  { title: '3% back at Whole Foods Market', merchantName: 'Whole Foods Market', cashbackBps: 300, description: 'Groceries reward, activate to enroll.' },
  { title: '10% back at Sweetgreen', merchantName: 'Sweetgreen', cashbackBps: 1000, description: 'Lunch reward through end of month.' },
  { title: '$5 off your next Uber', merchantName: 'Uber', cashbackBps: 0, description: 'Activate for a flat $5 credit on your next ride.' },
  { title: '4% back at Target', merchantName: 'Target', cashbackBps: 400, description: 'Activate to earn 4% on Target purchases this week.' },
  { title: '2% back at Amazon', merchantName: 'Amazon', cashbackBps: 200, description: 'Activate to earn 2% on Amazon purchases this month.' },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    let inserted = 0;
    for (const d of DEALS) {
      const merchant = await prisma.merchant.findUnique({ where: { name: d.merchantName } });
      const existing = await prisma.deal.findFirst({ where: { title: d.title } });
      if (existing) continue;
      await prisma.deal.create({
        data: {
          merchantId: merchant?.id,
          title: d.title,
          description: d.description,
          cashbackBps: d.cashbackBps,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      inserted++;
    }
    console.log(`Seeded ${inserted} deals.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
