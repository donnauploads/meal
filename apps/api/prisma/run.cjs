'use strict';
/*
 * Runs the local Prisma CLI with DATABASE_URL / DIRECT_URL resolved from the
 * DB_TARGET switch (see db-target.cjs), so every Prisma command hits the same
 * database the app does.
 *
 *   node prisma/run.cjs migrate deploy
 *   node prisma/run.cjs studio
 *   node prisma/run.cjs db seed
 */
require('./db-target.cjs');
const { spawnSync } = require('child_process');

const prismaBin = require.resolve('prisma/build/index.js');
const res = spawnSync(process.execPath, [prismaBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status === null ? 1 : res.status);
