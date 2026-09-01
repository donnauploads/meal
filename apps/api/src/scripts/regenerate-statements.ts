/**
 * Re-render every stored Statement PDF with the current renderer (State Bank
 * branding) and overwrite the file in place. Run once after a brand/renderer
 * change — existing statements were rendered + stored with the old design.
 *
 *   npx ts-node src/scripts/regenerate-statements.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StatementsService } from '../modules/statements/statements.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const svc = app.get(StatementsService);
    const res = await svc.regenerateAllStored();
    // console so it isn't filtered by the Nest logger level above
    console.log(
      `>>> Statements regenerated: ${res.regenerated}, failed: ${res.failed}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
