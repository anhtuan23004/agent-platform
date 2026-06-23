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

const SESSION = '00000000-0000-0000-0000-0000000000dd';

async function seedDemandPlanStaging(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.staging_changes
       (ingestion_session_id, table_id, natural_key_hash, change_type, new_values)
     VALUES ($1, 'project_demand_plan', $2, 'new_record', $3::jsonb)`,
    [
      SESSION,
      'nk-demand-DEM-001',
      JSON.stringify({
        demand_id: 'DEM-001',
        project_id: 'PRJ-001',
        role_needed: 'Designer',
        required_skills: 'figma|ux research|wireframing',
        demand_start: '2026-08-01',
        demand_end: '2026-08-31',
        demand_pct: 0.5,
        urgency: 'High',
        priority_score: 92,
        confirmed: 'TRUE',
        demand_source: 'uploaded_plan',
        note: 'Need design support',
        source_row: 4,
      }),
    ],
  );
}

describe('PMO_INGESTION_ADAPTER.publish project demand plan', () => {
  it('publishes demand plan rows into the canonical table', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantId = crypto.randomUUID();
        await seedDemandPlanStaging(pool);

        const publishResult = await PMO_INGESTION_ADAPTER.publish({
          ingestionSessionId: SESSION,
          tenantId,
        });

        expect(publishResult.rowsWritten.project_demand_plan).toBe(1);

        const rows = await pool.query<{
          demand_id: string;
          project_id: string;
          role_needed: string;
          required_skills: string[];
          urgency: string;
          confirmed: boolean;
          demand_source: string;
        }>(
          `SELECT demand_id,
                  project_id,
                  role_needed,
                  required_skills,
                  urgency,
                  confirmed,
                  demand_source
             FROM pmo.project_demand_plan
            WHERE tenant_id = $1`,
          [tenantId],
        );

        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]).toMatchObject({
          demand_id: 'DEM-001',
          project_id: 'PRJ-001',
          role_needed: 'Designer',
          required_skills: ['figma', 'ux research', 'wireframing'],
          urgency: 'high',
          confirmed: true,
          demand_source: 'uploaded_plan',
        });
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
