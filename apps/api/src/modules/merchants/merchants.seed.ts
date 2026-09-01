import { PrismaClient, TransactionCategory } from '@prisma/client';

export interface MerchantSeed {
  name: string;
  mcc?: string;
  logoUrl?: string;
  category: TransactionCategory;
}

export const MERCHANT_SEEDS: MerchantSeed[] = [
  { name: 'Whole Foods Market', mcc: '5411', category: TransactionCategory.groceries },
  { name: 'Trader Joe\'s',      mcc: '5411', category: TransactionCategory.groceries },
  { name: 'Costco Wholesale',   mcc: '5411', category: TransactionCategory.groceries },
  { name: 'Chipotle',           mcc: '5812', category: TransactionCategory.dining },
  { name: 'Starbucks',          mcc: '5814', category: TransactionCategory.dining },
  { name: 'Sweetgreen',         mcc: '5812', category: TransactionCategory.dining },
  { name: 'Uber',               mcc: '4121', category: TransactionCategory.transport },
  { name: 'Lyft',               mcc: '4121', category: TransactionCategory.transport },
  { name: 'NYC MTA',            mcc: '4111', category: TransactionCategory.transport },
  { name: 'Shell',              mcc: '5541', category: TransactionCategory.transport },
  { name: 'Netflix',            mcc: '4899', category: TransactionCategory.entertainment },
  { name: 'Spotify',            mcc: '5815', category: TransactionCategory.entertainment },
  { name: 'AMC Theatres',       mcc: '7832', category: TransactionCategory.entertainment },
  { name: 'Amazon',             mcc: '5942', category: TransactionCategory.shopping },
  { name: 'Target',             mcc: '5310', category: TransactionCategory.shopping },
  { name: 'Apple Store',        mcc: '5732', category: TransactionCategory.shopping },
  { name: 'Con Edison',         mcc: '4900', category: TransactionCategory.utilities },
  { name: 'Verizon',            mcc: '4814', category: TransactionCategory.utilities },
  { name: 'T-Mobile',           mcc: '4814', category: TransactionCategory.utilities },
  { name: 'CVS Pharmacy',       mcc: '5912', category: TransactionCategory.health },
  { name: 'Delta Air Lines',    mcc: '4511', category: TransactionCategory.travel },
  { name: 'Airbnb',             mcc: '7011', category: TransactionCategory.travel },
];

export async function seedMerchants(prisma: PrismaClient): Promise<number> {
  let inserted = 0;
  for (const m of MERCHANT_SEEDS) {
    const result = await prisma.merchant.upsert({
      where: { name: m.name },
      update: {},
      create: m,
    });
    if (result) inserted++;
  }
  return inserted;
}
