/**
 * Aggregator for `prisma db seed`.
 *
 * Each script under src/scripts/seed-*.ts is self-contained (own
 * PrismaClient, own main()). We just import them in dependency order
 * so a single `pnpm exec prisma db seed` runs the full demo bootstrap.
 *
 * Order matters:
 *   1. policies   — required by the signup gate
 *   2. merchants  — referenced by deals + transactions
 *   3. deals      — references merchants
 *   4. personas   — creates users + accounts + transactions
 */

import { spawnSync } from 'child_process';
import { resolve } from 'path';

// seed-personas creates demo users with known passwords + full account
// access. It's strictly OPT-IN — the script itself refuses to run
// without ENABLE_PERSONA_SEED=1 (see refuseUnlessOptedIn inside it),
// and we mirror the same gate here so production deploys don't even
// attempt it.
const OPT_IN_ONLY = new Set(['seed-personas.ts']);

const ALL_SCRIPTS = [
  'seed-policies.ts',
  'seed-merchants.ts',
  'seed-deals.ts',
  'seed-personas.ts',
];

const personaSeedEnabled = process.env.ENABLE_PERSONA_SEED === '1';

const SCRIPTS = personaSeedEnabled
  ? ALL_SCRIPTS
  : ALL_SCRIPTS.filter((s) => !OPT_IN_ONLY.has(s));

if (!personaSeedEnabled) {
  console.log(
    `▸ Skipping opt-in seeds (${[...OPT_IN_ONLY].join(', ')}) — set ENABLE_PERSONA_SEED=1 to include.`,
  );
}

const scriptsDir = resolve(__dirname, '..', 'src', 'scripts');

for (const file of SCRIPTS) {
  const full = resolve(scriptsDir, file);
  console.log(`\n▶ Running ${file}\n`);
  const r = spawnSync('node', ['-r', 'ts-node/register', full], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`✗ ${file} exited with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

console.log('\n✓ All seeds complete.');
