import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import { PMO_INGESTION_ADAPTER } from '../../src/backend/ingestion/pmo-ingestion-adapter.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

const SESSION = '00000000-0000-0000-0000-0000000000cc';

async function seedStagingMemberAndWeek(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.staging_changes
       (ingestion_session_id, table_id, natural_key_hash, change_type, new_values)
     VALUES ($1, 'member_master', $2, 'new_record', $3::jsonb)`,
    [
      SESSION,
      'nk-m-EMP-001',
      JSON.stringify({
        member_id: 'EMP-001',
        full_name: 'EMP-001',
        std_hours_week: 40,
        join_date: '2026-01-01',
      }),
    ],
  );
  await pool.query(
    `INSERT INTO pmo.staging_changes
       (ingestion_session_id, table_id, natural_key_hash, change_type, new_values)
     VALUES ($1, 'calendar_weeks', $2, 'new_record', $3::jsonb)`,
    [
      SESSION,
      'nk-w-W1',
      JSON.stringify({
        week_id: 'W1',
        week_start: '2026-06-29',
        week_end: '2026-07-05',
        working_days: 5,
        holiday_hours_ft: 0,
      }),
    ],
  );
}

describe('PMO_INGESTION_ADAPTER.publish', () => {
  it('computes member_week_facts immediately after publish', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedStagingMemberAndWeek(pool);

        const publishResult = await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION,
          tenantId: tenant,
        });

        expect(Object.values(publishResult.rowsWritten).reduce((sum, n) => sum + n, 0)).toBe(2);

        const facts = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pmo.member_week_facts WHERE tenant_id = $1`,
          [tenant],
        );
        expect(Number(facts.rows[0]?.count ?? 0)).toBeGreaterThan(0);
      } finally {
        await closePools();
      }
    });
  });
});
