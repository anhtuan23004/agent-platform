import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pmoDb } from '../db/client.ts';
import type * as schema from '../db/schema.ts';
import {
  calendarWeeks,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
  timesheets,
} from '../db/schema.ts';
import { computeNaturalKeyHash, computeSourceRowHash } from '../ingestion/stage-changes.ts';
import { buildPmo02AnswerKeyFixture } from './pmo-02.ts';

export interface SeedPmo02DemoFixtureInput {
  tenantId: string;
  ingestionSessionId?: string;
  db?: NodePgDatabase<typeof schema>;
}

export interface SeedPmo02DemoFixtureResult {
  ok: true;
  tenantId: string;
  ingestionSessionId: string;
  inserted: {
    members: number;
    projects: number;
    weeks: number;
    allocations: number;
    timesheets: number;
    leaves: number;
    config: number;
  };
}

function now(): Date {
  return new Date();
}

export async function seedPmo02DemoFixtureForTenant(
  input: SeedPmo02DemoFixtureInput,
): Promise<SeedPmo02DemoFixtureResult> {
  const db = input.db ?? pmoDb();
  const tenantId = input.tenantId;
  const ingestionSessionId = input.ingestionSessionId ?? randomUUID();
  const fixture = buildPmo02AnswerKeyFixture();

  await db.transaction(async (tx) => {
    // Clear existing tenant rows so the demo can be re-seeded idempotently.
    await tx.execute(sql`DELETE FROM ${resourceAllocations} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${timesheets} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${leaveRecords} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${memberMaster} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${projectMaster} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${calendarWeeks} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${overbookIdleConfig} WHERE tenant_id = ${tenantId}::uuid`);

    await tx.insert(memberMaster).values(
      fixture.members.map((m, i) => {
        const values = {
          member_id: m.member_id,
          full_name: m.full_name,
          role_title: m.role_title ?? null,
          std_hours_week: m.std_hours_week ?? null,
          join_date: m.join_date ?? null,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('member_master', tenantId, values),
          source_row_hash: computeSourceRowHash('member_master', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: i + 1,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    await tx.insert(projectMaster).values(
      fixture.projects.map((p, i) => {
        const values = {
          project_id: p.project_id,
          project_name: p.project_name,
          account_id: p.account_id ?? null,
          project_type: p.project_type ?? null,
          status: p.status ?? null,
          pm_id: p.pm_id ?? null,
          start_date: p.start_date ?? null,
          end_date: p.end_date ?? null,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('project_master', tenantId, values),
          source_row_hash: computeSourceRowHash('project_master', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: i + 1,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    await tx.insert(calendarWeeks).values(
      fixture.weeks.map((w, i) => {
        const values = {
          week_id: w.week_id,
          week_start: w.week_start,
          week_end: w.week_end,
          working_days: w.working_days,
          holiday_hours_ft: w.holiday_hours_ft ?? null,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('calendar_weeks', tenantId, values),
          source_row_hash: computeSourceRowHash('calendar_weeks', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: i + 1,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    {
      const values = {
        config_id: 'demo',
        rule_name: 'demo',
        overbook_threshold: 1.1,
        overbook_red_threshold: 1.2,
        idle_threshold: 0.75,
        mismatch_pct_threshold: 0.2,
        ot_max_hours_per_week: 48,
        required_training_hours: 0,
        effective_date: now(),
      };
      await tx.insert(overbookIdleConfig).values({
        tenant_id: tenantId,
        natural_key_hash: computeNaturalKeyHash('overbook_idle_config', tenantId, values),
        source_row_hash: computeSourceRowHash('overbook_idle_config', values),
        last_ingestion_session_id: ingestionSessionId,
        is_active: true,
        ...values,
        source_row: 1,
        created_at: now(),
        updated_at: now(),
      });
    }

    await tx.insert(resourceAllocations).values(
      fixture.allocations.map((a, i) => {
        const values = {
          member_id: a.member_id,
          project_id: a.project_id,
          start_date: a.start_date,
          end_date: a.end_date,
          allocation_pct: 1,
          role: a.role ?? null,
          weekly_planned_hours: a.weekly_planned_hours ?? null,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('resource_allocation', tenantId, values),
          source_row_hash: computeSourceRowHash('resource_allocation', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: i + 1,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    await tx.insert(timesheets).values(
      fixture.timesheets.map((t, i) => {
        const values = {
          member_id: t.member_id,
          work_date: t.work_date,
          project_id: null,
          log_category: null,
          logged_hours: t.logged_hours,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('timesheet', tenantId, values),
          source_row_hash: computeSourceRowHash('timesheet', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          member_id: t.member_id,
          project_id: null,
          work_date: t.work_date,
          logged_hours: t.logged_hours,
          log_category: null,
          task_ref: null,
          source_row: i + 1,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    await tx.insert(leaveRecords).values(
      fixture.leaves.map((l, i) => {
        const values = {
          member_id: l.member_id ?? null,
          leave_date: l.leave_date,
          leave_type: l.leave_type,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('leave', tenantId, values),
          source_row_hash: computeSourceRowHash('leave', {
            ...values,
            approved: l.approved ?? null,
            duration_days: l.duration_days ?? null,
          }),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          record_id: null,
          member_id: l.member_id ?? null,
          leave_date: l.leave_date,
          leave_type: l.leave_type,
          approved: l.approved ?? null,
          duration_days: l.duration_days ?? null,
          note: null,
          source_row: i + 1,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );
  });

  return {
    ok: true,
    tenantId,
    ingestionSessionId,
    inserted: {
      members: fixture.members.length,
      projects: fixture.projects.length,
      weeks: fixture.weeks.length,
      allocations: fixture.allocations.length,
      timesheets: fixture.timesheets.length,
      leaves: fixture.leaves.length,
      config: 1,
    },
  };
}
