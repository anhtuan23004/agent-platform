import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import { loadProjectDemandPlan } from '../../src/backend/reporting/forward-allocation/load-demand-plan.ts';
import { seedProjectDemandPlanForTenant } from '../../src/index.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('project demand plan seed', () => {
  it('loads tenant-scoped demand rows from CSV and queries them by overlapping horizon', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantA = crypto.randomUUID();
        const tenantB = crypto.randomUUID();

        const seeded = await seedProjectDemandPlanForTenant({ tenantId: tenantA });
        await seedProjectDemandPlanForTenant({ tenantId: tenantB });

        expect(seeded.inserted).toBe(3);

        const counts = await pool.query(
          `SELECT tenant_id, count(*)::int AS count
             FROM pmo.project_demand_plan
            GROUP BY tenant_id
            ORDER BY tenant_id`,
        );
        expect(counts.rows).toHaveLength(2);
        expect(counts.rows.every((row) => row.count === 3)).toBe(true);

        const tenantARows = await loadProjectDemandPlan({
          tenantId: tenantA,
          from: new Date('2026-08-10T00:00:00.000Z'),
          to: new Date('2026-08-31T23:59:59.000Z'),
        });
        expect(tenantARows).toHaveLength(3);
        expect(tenantARows.map((row) => row.demandId)).toEqual(['DEM-001', 'DEM-002', 'DEM-003']);
        expect(tenantARows[0]?.requiredSkills).toEqual(['figma', 'ux-research', 'wireframing']);
        expect(tenantARows[0]?.confirmed).toBe(true);

        const septemberOnly = await loadProjectDemandPlan({
          tenantId: tenantA,
          from: new Date('2026-09-19T00:00:00.000Z'),
          to: new Date('2026-09-25T23:59:59.000Z'),
        });
        expect(septemberOnly.map((row) => row.demandId)).toEqual(['DEM-003']);

        const tenantBRows = await pool.query(
          `SELECT demand_id
             FROM pmo.project_demand_plan
            WHERE tenant_id = $1
            ORDER BY demand_id`,
          [tenantB],
        );
        expect(tenantBRows.rows.map((row) => row.demand_id)).toEqual([
          'DEM-001',
          'DEM-002',
          'DEM-003',
        ]);
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
