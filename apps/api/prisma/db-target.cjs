'use strict';
/*
 * Single source of truth for which database the project talks to.
 *
 * One switch in .env — `DB_TARGET=docker` or `DB_TARGET=neon` — resolves the
 * real DATABASE_URL / DIRECT_URL from the matching named pair, e.g.:
 *
 *   DB_TARGET=docker
 *   DOCKER_DATABASE_URL=postgresql://bank:bank@localhost:5432/bank_demo?schema=public
 *   DOCKER_DIRECT_URL=postgresql://bank:bank@localhost:5432/bank_demo?schema=public
 *   NEON_DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require
 *   NEON_DIRECT_URL=postgresql://.../neondb?sslmode=require
 *
 * It runs in two places so the app and the Prisma CLI always agree:
 *   • App    — imported first via src/bootstrap-db-target.ts
 *   • Prisma — invoked through prisma/run.cjs (node prisma/run.cjs <args>)
 *
 * Dependency-free (no dotenv) so it works from the Prisma CLI preload and the
 * compiled app alike.
 */
const fs = require('fs');
const path = require('path');

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    val = val.replace(/\s+#.*$/, '').trim(); // strip trailing " # comment"
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const envFile = parseEnvFile(path.resolve(__dirname, '..', '.env'));
// process.env wins over the file so a shell override still works.
const get = (k) => (process.env[k] !== undefined ? process.env[k] : envFile[k]);

const target = (get('DB_TARGET') || 'docker').trim().toLowerCase();
const T = target.toUpperCase();
const url = get(`${T}_DATABASE_URL`);
const direct = get(`${T}_DIRECT_URL`) || url;

if (url) {
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = direct;
  const safe = url.replace(/\/\/[^@/]*@/, '//***@'); // hide credentials in logs
  console.log(`[db-target] "${target}" → ${safe}`);
} else {
  console.warn(
    `[db-target] DB_TARGET="${target}" but ${T}_DATABASE_URL is not set in .env`,
  );
}

module.exports = { target };
