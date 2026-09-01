/**
 * Resolves DATABASE_URL / DIRECT_URL from the single DB_TARGET switch in .env
 * BEFORE anything reads them (ConfigModule validation, PrismaClient). This
 * MUST be the very first import in main.ts.
 *
 * The logic lives in the shared, dependency-free prisma/db-target.cjs so the
 * app and the Prisma CLI (via prisma/run.cjs) resolve the target identically.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import { resolve } from 'path';

// __dirname is <api>/dist at runtime (and <api>/src under ts-node); both sit
// one level under the package root, so this points at <api>/prisma either way.
require(resolve(__dirname, '..', 'prisma', 'db-target.cjs'));
