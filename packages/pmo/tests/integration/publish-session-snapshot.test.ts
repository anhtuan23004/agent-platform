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

const SESSION_A = '00000000-0000-0000-0000-0000000000aa';
const SESSION_B = '00000000-0000-0000-0000-0000000000bb';

async function seedPublishedSession(
  pool: Pool,
  sessionId: string,
  tenantId: string,
  memberId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.ingestion_sessions
       (id, tenant_id, status, source_kind, created_by, publish_reviewed_at)
     VALUES ($1, $2, 'published', 'workbook', $3, now())`,
    [sessionId, tenantId, tenantId],
  );
  await pool.query(
    `INSERT INTO pmo.staging_changes
       (ingestion_session_id, table_id, natural_key_hash, change_type, new_values)
     VALUES ($1, 'member_master', $2, 'new_record', $3::jsonb)`,
    [
      sessionId,
      `nk-${sessionId}-member`,
      JSON.stringify({
        member_id: memberId,
        full_name: memberId,
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
      sessionId,
      `nk-${sessionId}-week`,
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

describe('publish session snapshot', () => {
  it('keeps independent snapshots per published session with the same natural key', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedPublishedSession(pool, SESSION_A, tenant, 'EMP-001');
        await seedPublishedSession(pool, SESSION_B, tenant, 'EMP-001');

        await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION_A,
          tenantId: tenant,
        });
        await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION_B,
          tenantId: tenant,
        });

        const members = await pool.query<{ session_id: string; member_id: string }>(
          `SELECT last_ingestion_session_id::text AS session_id, member_id
           FROM pmo.member_master
           WHERE tenant_id = $1
           ORDER BY last_ingestion_session_id`,
          [tenant],
        );

        expect(members.rows).toHaveLength(2);
        expect(members.rows.map((row) => row.session_id).sort()).toEqual(
          [SESSION_A, SESSION_B].sort(),
        );
      } finally {
        await closePools();
      }
    });
  });

  it('replaces only the republished session snapshot', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedPublishedSession(pool, SESSION_A, tenant, 'EMP-001');
        await seedPublishedSession(pool, SESSION_B, tenant, 'EMP-002');

        await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION_A,
          tenantId: tenant,
        });
        await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION_B,
          tenantId: tenant,
        });

        await pool.query(`DELETE FROM pmo.staging_changes WHERE ingestion_session_id = $1`, [
          SESSION_A,
        ]);
        await pool.query(
          `INSERT INTO pmo.staging_changes
             (ingestion_session_id, table_id, natural_key_hash, change_type, new_values)
           VALUES ($1, 'member_master', $2, 'new_record', $3::jsonb)`,
          [
            SESSION_A,
            `nk-${SESSION_A}-member-v2`,
            JSON.stringify({
              member_id: 'EMP-099',
              full_name: 'EMP-099',
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
            SESSION_A,
            `nk-${SESSION_A}-week`,
            JSON.stringify({
              week_id: 'W1',
              week_start: '2026-06-29',
              week_end: '2026-07-05',
              working_days: 5,
              holiday_hours_ft: 0,
            }),
          ],
        );

        await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION_A,
          tenantId: tenant,
        });

        const members = await pool.query<{ session_id: string; member_id: string }>(
          `SELECT last_ingestion_session_id::text AS session_id, member_id
           FROM pmo.member_master
           WHERE tenant_id = $1
           ORDER BY member_id`,
          [tenant],
        );

        expect(members.rows).toEqual(
          expect.arrayContaining([
            { session_id: SESSION_A, member_id: 'EMP-099' },
            { session_id: SESSION_B, member_id: 'EMP-002' },
          ]),
        );
        expect(members.rows).toHaveLength(2);
      } finally {
        await closePools();
      }
    });
  });
});
