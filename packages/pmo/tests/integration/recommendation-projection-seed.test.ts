import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import { seedRecommendationProjectionsForTenant } from '../../src/index.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('recommendation projection CSV seed', () => {
  it('bootstraps member mappings and loads skills/history projections from CSV', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantId = crypto.randomUUID();
        const result = await seedRecommendationProjectionsForTenant({ tenantId });

        expect(result.inserted.bootstrappedMembers).toBeGreaterThan(0);
        expect(result.inserted.skillRows).toBeGreaterThan(0);
        expect(result.inserted.taskHistoryRows).toBeGreaterThan(0);
        expect(result.freshness.skillCount).toBe(result.inserted.skillRows);
        expect(result.freshness.taskCount).toBe(result.inserted.taskHistoryRows);

        const members = await pool.query(
          `SELECT member_id
             FROM pmo.member_master
            WHERE tenant_id = $1
              AND is_active = true
              AND member_id IN ('EMP-004', 'EMP-103', 'EMP-113', 'EMP-119', 'EMP-120')
            ORDER BY member_id`,
          [tenantId],
        );
        expect(members.rows.map((row) => row.member_id)).toEqual([
          'EMP-004',
          'EMP-103',
          'EMP-113',
          'EMP-119',
          'EMP-120',
        ]);

        const skills = await pool.query(
          `SELECT count(*)::int AS count
             FROM pmo.member_skills_projection
            WHERE tenant_id = $1
              AND is_active = true`,
          [tenantId],
        );
        expect(skills.rows[0]?.count).toBe(result.inserted.skillRows);

        const history = await pool.query(
          `SELECT count(*)::int AS count
             FROM pmo.task_history_projection
            WHERE tenant_id = $1
              AND is_active = true`,
          [tenantId],
        );
        expect(history.rows[0]?.count).toBe(result.inserted.taskHistoryRows);
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
