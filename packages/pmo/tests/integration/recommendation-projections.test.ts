import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import {
  getRecommendationProjectionFreshness,
  syncMemberSkillProjection,
  syncTaskHistoryProjection,
} from '../../src/backend/reporting/recommendations/sync-projections.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});
const SESSION = '00000000-0000-0000-0000-0000000000aa';

async function seedMember(pool: Pool, tenantId: string, memberId: string): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.member_master
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        member_id, full_name, std_hours_week, join_date)
     VALUES ($1,$2,$3,$4,true,$5,$5,40,'2026-01-01')`,
    [tenantId, `nk-${memberId}`, `sr-${memberId}`, SESSION, memberId],
  );
}

describe('recommendation projections', () => {
  it('upserts idempotently, stays tenant scoped, and rejects missing member mapping', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        const otherTenant = crypto.randomUUID();
        await seedMember(pool, tenant, 'EMP-001');
        await syncMemberSkillProjection({
          tenantId: tenant,
          memberId: 'EMP-001',
          skillName: 'Spring Boot',
          proficiencyLevel: 3,
          source: 'identity.event',
          sourceVersion: 'v1',
          idempotencyKey: 'skill-1',
          observedAt: new Date('2026-06-29T00:00:00.000Z'),
        });
        await syncMemberSkillProjection({
          tenantId: tenant,
          memberId: 'EMP-001',
          skillName: 'Spring Boot',
          proficiencyLevel: 4,
          source: 'identity.event',
          sourceVersion: 'v2',
          idempotencyKey: 'skill-1',
          observedAt: new Date('2026-06-30T00:00:00.000Z'),
        });
        await syncTaskHistoryProjection({
          tenantId: tenant,
          historyId: 'TASK-1',
          memberId: 'EMP-001',
          projectId: 'PRJ-1',
          taskTitle: 'API implementation',
          skillTags: ['Spring Boot', 'REST API'],
          completedAt: new Date('2026-07-01T00:00:00.000Z'),
          source: 'planner.event',
          sourceVersion: 'v1',
          idempotencyKey: 'task-1',
        });

        expect(await getRecommendationProjectionFreshness(tenant)).toMatchObject({
          skillCount: 1,
          taskCount: 1,
        });
        expect(await getRecommendationProjectionFreshness(otherTenant)).toMatchObject({
          skillCount: 0,
          taskCount: 0,
        });
        await expect(
          syncMemberSkillProjection({
            tenantId: tenant,
            memberId: 'UNKNOWN',
            skillName: 'Java',
            source: 'identity.event',
            sourceVersion: 'v1',
            idempotencyKey: 'unknown',
            observedAt: new Date(),
          }),
        ).rejects.toThrow('recommendation_member_mapping_missing:UNKNOWN');
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
