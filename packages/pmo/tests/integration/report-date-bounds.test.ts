import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { getPmoReportDateBoundsByIngestionSession } from '../../src/backend/analytics/report-date-bounds.ts';
import { resetPmoDb } from '../../src/backend/db/client.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('PMO report date bounds', () => {
  it('derives per-upload bounds from canonical rows when reporting_period is absent', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        const otherTenant = crypto.randomUUID();
        const sessionA = crypto.randomUUID();
        const sessionB = crypto.randomUUID();

        await pool.query(
          `INSERT INTO pmo.resource_allocations
             (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
              member_id, project_id, allocation_pct, start_date, end_date)
           VALUES
             ($1,'nk-a1','sr-a1',$2,true,'EMP-001','PRJ-1',1,'2026-06-29','2026-07-05'),
             ($1,'nk-a2','sr-a2',$2,true,'EMP-001','PRJ-1',1,'2026-07-06','2026-07-26'),
             ($1,'nk-b1','sr-b1',$3,true,'EMP-002','PRJ-2',1,'2026-08-03','2026-08-09'),
             ($1,'nk-inactive','sr-inactive',$3,false,'EMP-002','PRJ-2',1,'2026-01-01','2026-12-31'),
             ($4,'nk-other','sr-other',$2,true,'EMP-003','PRJ-3',1,'2025-01-01','2025-01-31')`,
          [tenant, sessionA, sessionB, otherTenant],
        );

        const bounds = await getPmoReportDateBoundsByIngestionSession(tenant, [sessionA, sessionB]);

        expect(bounds.get(sessionA)).toEqual({ min: '2026-06-29', max: '2026-07-26' });
        expect(bounds.get(sessionB)).toEqual({ min: '2026-08-03', max: '2026-08-09' });
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
