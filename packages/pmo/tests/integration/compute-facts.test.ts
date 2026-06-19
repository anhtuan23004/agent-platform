import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { detectMismatch, detectOverbookIdle } from '../../src/backend/analytics/findings.ts';
import { loadCanonicalInputs } from '../../src/backend/analytics/load-canonical.ts';
import {
  computeAndPersistFacts,
  loadMemberWeekFacts,
} from '../../src/backend/analytics/persist-facts.ts';
import { resolveThresholds } from '../../src/backend/analytics/thresholds.ts';
import { resetPmoDb } from '../../src/backend/db/client.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

const SESSION = '00000000-0000-0000-0000-0000000000aa';

// ── Seed helpers (insert canonical pmo rows directly) ────────────────────────

async function seedMember(
  pool: Pool,
  tenant: string,
  memberId: string,
  std: number,
  joinDate: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.member_master
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        member_id, full_name, std_hours_week, join_date)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8)`,
    [tenant, `nk-m-${memberId}`, `sr-m-${memberId}`, SESSION, memberId, memberId, std, joinDate],
  );
}

async function seedAlloc(
  pool: Pool,
  tenant: string,
  memberId: string,
  projectId: string,
  hours: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.resource_allocations
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        member_id, project_id, allocation_pct, start_date, end_date, weekly_planned_hours)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10)`,
    [
      tenant,
      `nk-a-${memberId}-${projectId}`,
      `sr-a-${memberId}-${projectId}`,
      SESSION,
      memberId,
      projectId,
      hours / 40,
      '2026-06-29',
      '2026-08-07',
      hours,
    ],
  );
}

async function seedTimesheet(
  pool: Pool,
  tenant: string,
  memberId: string,
  workDate: string,
  hours: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.timesheets
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        member_id, work_date, logged_hours, log_category)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,'Project')`,
    [
      tenant,
      `nk-t-${memberId}-${workDate}`,
      `sr-t-${memberId}-${workDate}`,
      SESSION,
      memberId,
      workDate,
      hours,
    ],
  );
}

async function seedLeave(
  pool: Pool,
  tenant: string,
  memberId: string,
  date: string,
  type: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.leave_records
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        member_id, leave_date, leave_type, approved, duration_days)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,true,1)`,
    [
      tenant,
      `nk-l-${memberId}-${date}-${type}`,
      `sr-l-${memberId}-${date}`,
      SESSION,
      memberId,
      date,
      type,
    ],
  );
}

const WEEKS: Array<[string, string, string, number]> = [
  ['W1', '2026-06-29', '2026-07-03', 5],
  ['W2', '2026-07-06', '2026-07-10', 5],
  ['W3', '2026-07-13', '2026-07-17', 4],
  ['W4', '2026-07-20', '2026-07-24', 5],
  ['W5', '2026-07-27', '2026-07-31', 5],
  ['W6', '2026-08-03', '2026-08-07', 5],
];

async function seedCalendar(pool: Pool, tenant: string): Promise<void> {
  for (const [wid, start, end, days] of WEEKS) {
    await pool.query(
      `INSERT INTO pmo.calendar_weeks
         (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
          week_id, week_start, week_end, working_days, holiday_hours_ft)
       VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9)`,
      [tenant, `nk-w-${wid}`, `sr-w-${wid}`, SESSION, wid, start, end, days, days === 4 ? 8 : 0],
    );
  }
}

async function seedConfig(pool: Pool, tenant: string): Promise<void> {
  await pool.query(
    `INSERT INTO pmo.overbook_idle_config
       (tenant_id, natural_key_hash, source_row_hash, last_ingestion_session_id, is_active,
        config_id, rule_name, overbook_threshold, overbook_red_threshold, idle_threshold,
        mismatch_pct_threshold, ot_max_hours_per_week, effective_date)
     VALUES ($1,$2,$3,$4,true,'CFG-001','SOP',1.1,1.2,0.75,0.2,48,'2026-01-01')`,
    [tenant, 'nk-cfg', 'sr-cfg', SESSION],
  );
}

/** Seed the canonical fixture (4 representative members + refs). */
async function seedFixture(pool: Pool, tenant: string): Promise<void> {
  await seedCalendar(pool, tenant);
  await seedConfig(pool, tenant);

  // EMP-004 overbook: planned 50 / std 40 = 125%
  await seedMember(pool, tenant, 'EMP-004', 40, '2020-01-01');
  await seedAlloc(pool, tenant, 'EMP-004', 'PRJ-001', 32);
  await seedAlloc(pool, tenant, 'EMP-004', 'PRJ-002', 18);
  for (const [, start] of WEEKS) await seedTimesheet(pool, tenant, 'EMP-004', start, 48);

  // EMP-005 idle: planned 24 / 40 = 60%
  await seedMember(pool, tenant, 'EMP-005', 40, '2020-01-01');
  await seedAlloc(pool, tenant, 'EMP-005', 'PRJ-001', 12);
  await seedAlloc(pool, tenant, 'EMP-005', 'PRJ-002', 12);
  for (const [, start] of WEEKS) await seedTimesheet(pool, tenant, 'EMP-005', start, 23);

  // EMP-006 mismatch_over (no OT): logged ~47 vs planned 38
  await seedMember(pool, tenant, 'EMP-006', 40, '2020-01-01');
  await seedAlloc(pool, tenant, 'EMP-006', 'PRJ-001', 38);
  const e6 = [48, 48, 38, 48, 50, 48];
  for (let i = 0; i < WEEKS.length; i++) {
    await seedTimesheet(pool, tenant, 'EMP-006', WEEKS[i]?.[1] as string, e6[i] ?? 0);
  }

  // EMP-003 edge: full leave W2 + approved OT W5 → not flagged
  await seedMember(pool, tenant, 'EMP-003', 40, '2020-01-01');
  await seedAlloc(pool, tenant, 'EMP-003', 'PRJ-002', 40);
  const e3 = [40, 0, 24, 40, 52, 40];
  for (let i = 0; i < WEEKS.length; i++) {
    await seedTimesheet(pool, tenant, 'EMP-003', WEEKS[i]?.[1] as string, e3[i] ?? 0);
  }
  for (const day of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']) {
    await seedLeave(pool, tenant, 'EMP-003', day, 'Annual Leave');
  }
  for (const day of ['2026-07-27', '2026-07-28']) {
    await seedLeave(pool, tenant, 'EMP-003', day, 'Approved OT Comp');
  }
}

describe('pmo analytics — compute + detect (DB)', () => {
  it('persists member-week facts and detects findings matching the Answer_Key', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenant = crypto.randomUUID();
        await seedFixture(pool, tenant);

        // ── Compute + persist ──────────────────────────────────────────────
        const result = await computeAndPersistFacts(tenant, SESSION);
        expect(result.memberCount).toBe(4);
        expect(result.weekIds).toHaveLength(6);
        expect(result.factCount).toBe(24); // 4 members × 6 weeks

        const persisted = await loadMemberWeekFacts(tenant);
        expect(persisted).toHaveLength(24);
        expect(await loadMemberWeekFacts(tenant, { weekIds: ['W1'] })).toHaveLength(4);
        expect(await loadMemberWeekFacts(tenant, { weekIds: [] })).toHaveLength(0);
        expect(await loadMemberWeekFacts(tenant, { ingestionSessionId: SESSION })).toHaveLength(24);
        expect(
          await loadMemberWeekFacts(tenant, {
            weekIds: ['W1'],
            ingestionSessionId: '00000000-0000-0000-0000-0000000000bb',
          }),
        ).toHaveLength(0);

        // ── Build context for detectors ────────────────────────────────────
        const inputs = await loadCanonicalInputs(tenant);
        const ctx = {
          leaves: inputs.leaves,
          weeksById: new Map(inputs.weeks.map((w) => [w.week_id, w])),
          thresholds: resolveThresholds(inputs.configRows),
        };

        // ── Overbook / idle ────────────────────────────────────────────────
        const obi = detectOverbookIdle(persisted, ctx);
        const emp004 = obi.find((f) => f.memberId === 'EMP-004');
        expect(emp004?.issueType).toBe('overbook');
        expect(emp004?.busyRate).toBeCloseTo(1.25, 2);
        const emp005 = obi.find((f) => f.memberId === 'EMP-005');
        expect(emp005?.issueType).toBe('idle');
        expect(emp005?.busyRate).toBeCloseTo(0.6, 2);

        // ── Mismatch ───────────────────────────────────────────────────────
        const mm = detectMismatch(persisted, ctx);
        const emp006 = mm.find((f) => f.memberId === 'EMP-006');
        expect(emp006?.issueType).toBe('mismatch_over');
        // EMP-003 leave + approved OT → NOT a genuine finding
        expect(mm.find((f) => f.memberId === 'EMP-003')).toBeUndefined();

        // ── Idempotent recompute ───────────────────────────────────────────
        const second = await computeAndPersistFacts(tenant, SESSION);
        expect(second.factCount).toBe(24);
        expect(await loadMemberWeekFacts(tenant)).toHaveLength(24);
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
