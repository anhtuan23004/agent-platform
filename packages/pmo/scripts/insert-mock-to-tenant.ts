/**
 * Load cleaned PMO_02 canonical rows from repo-root `mock-data.db` (SQLite)
 * into Postgres `pmo.*` tables for a tenant.
 *
 * Prerequisite: run insert-mock.ts to build/refresh mock-data.db (auto-built if missing).
 *
 * Usage:
 *   TENANT_ID=<uuid> node --experimental-strip-types packages/pmo/scripts/insert-mock-to-tenant.ts
 *   MOCK_DB_PATH=/path/to/mock-data.db  # optional
 */

import { closePools, initPools } from '@seta/shared-db';
import { DEFAULT_REPO_MOCK_DB_PATH } from '../src/backend/demo/seed-from-mock-db.ts';
import { seedPmo02FromMockDbForTenant } from '../src/index.ts';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const TENANT_ID = requireEnv('TENANT_ID');
const MOCK_DB_PATH = process.env.MOCK_DB_PATH ?? DEFAULT_REPO_MOCK_DB_PATH;
const INGESTION_SESSION_ID = process.env.INGESTION_SESSION_ID ?? crypto.randomUUID();

try {
  initPools({ databaseUrl: requireEnv('DATABASE_URL') });
  const result = await seedPmo02FromMockDbForTenant({
    tenantId: TENANT_ID,
    mockDbPath: MOCK_DB_PATH,
    ingestionSessionId: INGESTION_SESSION_ID,
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closePools();
}
