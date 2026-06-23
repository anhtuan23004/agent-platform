import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ensureFactsComputed } from '../../src/backend/analytics/ensure-facts-computed.ts';
import { resetPmoDb } from '../../src/backend/db/client.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

const SESSION_A = '00000000-0000-0000-0000-0000000000aa';
const SESSION_B = '00000000-0000-0000-0000-0000000000bb';

async function seedCanonicalMember(pool: Pool, tenant: string): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.member_master
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        member_id, full_name, std_hours_week, join_date)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8)`,
    [tenant, 'nk-m-EMP-001', 'sr-m-EMP-001', SESSION_A, 'EMP-001', 'EMP-001', 40, '2026-01-01'],
  );
}

async function seedWeek(pool: Pool, tenant: string): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.calendar_weeks
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        week_id, week_start, week_end, working_days, holiday_hours_ft)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9)`,
    [tenant, 'nk-w-W1', 'sr-w-W1', SESSION_A, 'W1', '2026-06-29', '2026-07-05', 5, 0],
  );
}

async function seedPublishedSession(
  pool: Pool,
  tenant: string,
  sessionId: string,
  reviewedAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.ingestion_sessions
       (id, tenant_id, status, source_file_key, source_file_name, mime_type, created_by,
        publish_reviewed_at)
     VALUES ($1,$2,'published',$3,$4,$5,$6,$7)`,
    [
      sessionId,
      tenant,
      `pmo/${sessionId}/book.xlsx`,
      'book.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '00000000-0000-0000-0000-000000000001',
      reviewedAt,
    ],
  );
}

describe('ensureFactsComputed (DB)', () => {
  it('recomputes when facts are empty, then skips when fresh', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedPublishedSession(pool, tenant, SESSION_A, '2026-06-01T10:00:00.000Z');
        await seedCanonicalMember(pool, tenant);
        await seedWeek(pool, tenant);

        const first = await ensureFactsComputed(tenant);
        expect(first.recomputed).toBe(true);
        expect(first.factCount).toBeGreaterThan(0);
        expect(first.canonicalDataVersion).toMatch(/^[a-f0-9]{64}$/);
        expect(first.factsVersion).toMatch(/^[a-f0-9]{64}$/);

        const second = await ensureFactsComputed(tenant);
        expect(second.recomputed).toBe(false);
        expect(second.factCount).toBe(first.factCount);
        expect(second.factsVersion).toBe(first.factsVersion);
      } finally {
        await closePools();
      }
    });
  });

  it('recomputes when canonical watermark changes without a publish timestamp', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedPublishedSession(pool, tenant, SESSION_A, '2026-06-01T10:00:00.000Z');
        await seedCanonicalMember(pool, tenant);
        await seedWeek(pool, tenant);

        const first = await ensureFactsComputed(tenant);
        await pool.query(
          `UPDATE pmo.member_master
             SET full_name = 'Changed', updated_at = '2026-06-22T00:00:00.000Z'
           WHERE tenant_id = $1 AND member_id = 'EMP-001'`,
          [tenant],
        );

        const second = await ensureFactsComputed(tenant);
        expect(second.recomputed).toBe(true);
        expect(second.canonicalDataVersion).not.toBe(first.canonicalDataVersion);
        expect(second.factsVersion).not.toBe(first.factsVersion);
      } finally {
        await closePools();
      }
    });
  });

  it('recomputes when a newer published session exists', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedPublishedSession(pool, tenant, SESSION_A, '2026-06-01T10:00:00.000Z');
        await seedCanonicalMember(pool, tenant);
        await seedWeek(pool, tenant);

        const first = await ensureFactsComputed(tenant, { force: true, sessionId: SESSION_A });
        expect(first.recomputed).toBe(true);

        await pool.query(`UPDATE pmo.member_week_facts SET computed_at = $1 WHERE tenant_id = $2`, [
          '2026-06-01T10:00:00.000Z',
          tenant,
        ]);
        await seedPublishedSession(pool, tenant, SESSION_B, '2026-06-02T10:00:00.000Z');

        const second = await ensureFactsComputed(tenant);
        expect(second.recomputed).toBe(true);
      } finally {
        await closePools();
      }
    });
  });

  it('force always recomputes', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedPublishedSession(pool, tenant, SESSION_A, '2026-06-01T10:00:00.000Z');
        await seedCanonicalMember(pool, tenant);
        await seedWeek(pool, tenant);

        await ensureFactsComputed(tenant, { force: true, sessionId: SESSION_A });
        const again = await ensureFactsComputed(tenant, { force: true, sessionId: SESSION_A });
        expect(again.recomputed).toBe(true);
      } finally {
        await closePools();
      }
    });
  });
});
