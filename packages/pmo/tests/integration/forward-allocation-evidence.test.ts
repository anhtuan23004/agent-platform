import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { ensureFactsComputed } from '../../src/backend/analytics/ensure-facts-computed.ts';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import { loadForwardAllocationEvidence } from '../../src/backend/reporting/forward-allocation/load-evidence.ts';
import {
  seedPmo02FromMockDbForTenant,
  seedProjectDemandPlanForTenant,
  seedRecommendationProjectionsForTenant,
} from '../../src/index.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('forward allocation evidence (DB)', () => {
  it('loads canonical evidence, recommendation projections, and seeded demand windows', async () => {
    await withTestDb(dbCfg(), async ({ databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantId = crypto.randomUUID();

        await seedPmo02FromMockDbForTenant({ tenantId });
        await seedRecommendationProjectionsForTenant({ tenantId });
        await seedProjectDemandPlanForTenant({ tenantId });
        await ensureFactsComputed(tenantId, { force: true });

        const evidence = await loadForwardAllocationEvidence({
          tenantId,
          evidenceFrom: new Date('2026-06-29T00:00:00.000Z'),
          evidenceTo: new Date('2026-08-07T00:00:00.000Z'),
        });

        expect(evidence.window.planningStart.toISOString()).toBe('2026-08-10T00:00:00.000Z');
        expect(evidence.window.planningEnd.toISOString()).toBe('2026-10-04T00:00:00.000Z');
        expect(evidence.members.length).toBeGreaterThan(0);
        expect(evidence.projects.length).toBeGreaterThan(0);
        expect(evidence.allocations.length).toBeGreaterThan(0);
        expect(evidence.skills.length).toBeGreaterThan(0);
        expect(evidence.taskHistory.length).toBeGreaterThan(0);
        expect(evidence.demandWindows.map((row) => row.demandId)).toEqual([
          'DEM-001',
          'DEM-002',
          'DEM-003',
        ]);
        expect(evidence.demandGaps.map((row) => row.demandId)).toEqual([
          'DEM-001',
          'DEM-002',
          'DEM-003',
        ]);
        expect(evidence.modeSummary.demandBackedCount).toBe(2);
        expect(evidence.modeSummary.inferredCount).toBe(1);
        expect(evidence.demandGaps[0]).toMatchObject({
          recommendationMode: 'demand_backed',
          recommendationTypeHint: 'extend',
        });
        expect(evidence.demandGaps[2]).toMatchObject({
          recommendationMode: 'inferred',
          recommendationTypeHint: 'fill_gap',
        });
        expect(
          evidence.demandWindows.find((row) => row.demandId === 'DEM-003')?.evidenceFlags,
        ).toEqual(['requires_demand_confirmation']);
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
