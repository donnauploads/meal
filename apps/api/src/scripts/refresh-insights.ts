// Refresh both insights materialized views. Wire this into a nightly cron in a later stage.
//
// Usage: pnpm --filter api exec ts-node src/scripts/refresh-insights.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { InsightsService } from '../modules/insights/insights.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(InsightsService).refreshViews();
  console.log('Refreshed transactions_monthly_v + transactions_by_category_v.');
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
