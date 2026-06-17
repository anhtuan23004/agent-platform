import { seedPmo02DemoFixtureForTenant } from '../src/index.ts';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const result = await seedPmo02DemoFixtureForTenant({
  tenantId: requireEnv('TENANT_ID'),
  ingestionSessionId: process.env.INGESTION_SESSION_ID,
});

// eslint-disable-next-line no-console
console.log(JSON.stringify(result, null, 2));
