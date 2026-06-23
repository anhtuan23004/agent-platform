import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const pmoSchema = pgSchema('pmo');

// ── Ingestion metadata ──────────────────────────────────────────────────────

export const ingestionSessions = pmoSchema.table(
  'ingestion_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    status: text('status').notNull().default('uploaded'),
    source_kind: text('source_kind').notNull().default('workbook'),
    // Status lifecycle:
    // uploaded → generating_plan → plan_review → approved_plan
    // → profiling → awaiting_confirmation → confirmed → normalizing
    // → staging_normalized → awaiting_publish_review → reviewed | published
    // Terminal: reviewed, published, failed, rejected
    source_file_key: text('source_file_key'),
    source_file_name: text('source_file_name'),
    source_file_size_bytes: integer('source_file_size_bytes'),
    mime_type: text('mime_type'),
    // Reporting period (user selects at upload time)
    reporting_period_key: text('reporting_period_key'),
    reporting_period_start: timestamp('reporting_period_start', { withTimezone: true }),
    reporting_period_end: timestamp('reporting_period_end', { withTimezone: true }),
    // Schema inference results
    detected_schema: jsonb('detected_schema'),
    confirmed_mapping: jsonb('confirmed_mapping'),
    workbook_confidence: real('workbook_confidence'),
    change_summary: jsonb('change_summary'),
    // Planning state (before workbook parsing starts)
    planning_goal: text('planning_goal'),
    planning_intent: jsonb('planning_intent'),
    planning_plan: jsonb('planning_plan'),
    planning_plan_version: integer('planning_plan_version').notNull().default(0),
    planning_feedback_history: jsonb('planning_feedback_history'),
    planning_last_generated_at: timestamp('planning_last_generated_at', { withTimezone: true }),
    planning_generation_started_at: timestamp('planning_generation_started_at', {
      withTimezone: true,
    }),
    planning_generation_error: text('planning_generation_error'),
    planning_approved_at: timestamp('planning_approved_at', { withTimezone: true }),
    workflow_execution_state: jsonb('workflow_execution_state'),
    profiling_documents: jsonb('profiling_documents'),
    profiling_summary: jsonb('profiling_summary'),
    workflow_current_step: text('workflow_current_step'),
    workflow_step_status: text('workflow_step_status'),
    workflow_started_at: timestamp('workflow_started_at', { withTimezone: true }),
    workflow_updated_at: timestamp('workflow_updated_at', { withTimezone: true }),
    // Publish audit
    publish_decision: text('publish_decision'),
    publish_reviewed_by: uuid('publish_reviewed_by'),
    publish_reviewed_at: timestamp('publish_reviewed_at', { withTimezone: true }),
    publish_review_note: text('publish_review_note'),
    // Lifecycle
    created_by: uuid('created_by').notNull(),
    /** PMO Agent chat thread that uploaded this workbook; null for workflow UI uploads. */
    chat_thread_id: uuid('chat_thread_id'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
    finished_at: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('ingestion_sessions_tenant_status').on(t.tenant_id, t.status),
    index('ingestion_sessions_tenant_period').on(t.tenant_id, t.reporting_period_key),
    index('ingestion_sessions_chat_thread').on(t.tenant_id, t.chat_thread_id),
  ],
);

// ── Canonical target tables (per-session published snapshots) ───────────────

export const resourceAllocations = pmoSchema.table(
  'resource_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    member_id: text('member_id').notNull(),
    project_id: text('project_id').notNull(),
    role: text('role'),
    allocation_pct: real('allocation_pct').notNull(),
    start_date: timestamp('start_date', { withTimezone: true }).notNull(),
    end_date: timestamp('end_date', { withTimezone: true }).notNull(),
    weekly_planned_hours: real('weekly_planned_hours'),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ra_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('ra_tenant_active').on(t.tenant_id, t.is_active),
    index('ra_member_project').on(t.tenant_id, t.member_id, t.project_id),
  ],
);

export const timesheets = pmoSchema.table(
  'timesheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    member_id: text('member_id').notNull(),
    project_id: text('project_id'),
    work_date: timestamp('work_date', { withTimezone: true }).notNull(),
    logged_hours: real('logged_hours').notNull(),
    log_category: text('log_category'),
    task_ref: text('task_ref'),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ts_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('ts_tenant_active').on(t.tenant_id, t.is_active),
    index('ts_member_date').on(t.tenant_id, t.member_id, t.work_date),
  ],
);

export const leaveRecords = pmoSchema.table(
  'leave_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    record_id: text('record_id'),
    member_id: text('member_id'),
    leave_date: timestamp('leave_date', { withTimezone: true }).notNull(),
    leave_type: text('leave_type').notNull(),
    approved: boolean('approved'),
    duration_days: real('duration_days'),
    note: text('note'),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('leave_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('leave_tenant_active').on(t.tenant_id, t.is_active),
    index('leave_member').on(t.tenant_id, t.member_id),
  ],
);

export const projectMaster = pmoSchema.table(
  'project_master',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    project_id: text('project_id').notNull(),
    project_name: text('project_name').notNull(),
    account_id: text('account_id'),
    project_type: text('project_type'),
    status: text('status'),
    pm_id: text('pm_id'),
    start_date: timestamp('start_date', { withTimezone: true }),
    end_date: timestamp('end_date', { withTimezone: true }),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('proj_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('proj_tenant_active').on(t.tenant_id, t.is_active),
  ],
);

export const memberMaster = pmoSchema.table(
  'member_master',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    member_id: text('member_id').notNull(),
    full_name: text('full_name').notNull(),
    department: text('department'),
    role_title: text('role_title'),
    level: text('level'),
    line_manager_id: text('line_manager_id'),
    employment_status: text('employment_status'),
    employment: text('employment'),
    std_hours_week: real('std_hours_week'),
    join_date: timestamp('join_date', { withTimezone: true }),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('member_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('member_tenant_active').on(t.tenant_id, t.is_active),
  ],
);

export const overbookIdleConfig = pmoSchema.table(
  'overbook_idle_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    config_id: text('config_id').notNull(),
    rule_name: text('rule_name').notNull(),
    overbook_threshold: real('overbook_threshold').notNull(),
    overbook_red_threshold: real('overbook_red_threshold'),
    idle_threshold: real('idle_threshold').notNull(),
    mismatch_pct_threshold: real('mismatch_pct_threshold'),
    ot_max_hours_per_week: real('ot_max_hours_per_week'),
    required_training_hours: real('required_training_hours'),
    effective_date: timestamp('effective_date', { withTimezone: true }),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('config_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('config_tenant_active').on(t.tenant_id, t.is_active),
  ],
);

export const projectDemandPlan = pmoSchema.table(
  'project_demand_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    demand_id: text('demand_id').notNull(),
    project_id: text('project_id').notNull(),
    role_needed: text('role_needed').notNull(),
    required_skills: jsonb('required_skills').$type<string[]>().notNull().default([]),
    demand_start: timestamp('demand_start', { withTimezone: true }).notNull(),
    demand_end: timestamp('demand_end', { withTimezone: true }).notNull(),
    demand_pct: real('demand_pct'),
    demand_hours_per_week: real('demand_hours_per_week'),
    urgency: text('urgency').notNull().default('medium'),
    priority_score: real('priority_score'),
    confirmed: boolean('confirmed').notNull().default(false),
    demand_source: text('demand_source').notNull().default('seeded_mock'),
    note: text('note'),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('project_demand_plan_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
    index('project_demand_plan_tenant_active').on(t.tenant_id, t.is_active),
    index('project_demand_plan_project_period').on(
      t.tenant_id,
      t.project_id,
      t.demand_start,
      t.demand_end,
    ),
    check('project_demand_plan_period_check', sql`${t.demand_end} >= ${t.demand_start}`),
    check(
      'project_demand_plan_capacity_check',
      sql`${t.demand_pct} IS NOT NULL OR ${t.demand_hours_per_week} IS NOT NULL`,
    ),
  ],
);

export const calendarWeeks = pmoSchema.table(
  'calendar_weeks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    week_id: text('week_id').notNull(),
    week_start: timestamp('week_start', { withTimezone: true }).notNull(),
    week_end: timestamp('week_end', { withTimezone: true }).notNull(),
    working_days: integer('working_days').notNull(),
    holiday_hours_ft: real('holiday_hours_ft'),
    note: text('note'),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('cal_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('cal_tenant_active').on(t.tenant_id, t.is_active),
  ],
);

export const kpiNorms = pmoSchema.table(
  'kpi_norms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // Business fields
    norm_id: text('norm_id').notNull(),
    metric: text('metric').notNull(),
    formula: text('formula'),
    green: text('green'),
    yellow: text('yellow'),
    red: text('red'),
    used_for: text('used_for'),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('kpi_session_natural_key_unique').on(
      t.tenant_id,
      t.last_ingestion_session_id,
      t.natural_key_hash,
    ),
    index('kpi_tenant_active').on(t.tenant_id, t.is_active),
  ],
);

// ── Staging changes (generated during normalize, reviewed before publish) ───

export const stagingChanges = pmoSchema.table(
  'staging_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestion_session_id: uuid('ingestion_session_id').notNull(),
    table_id: text('table_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    change_type: text('change_type').notNull(),
    // change_type: 'new_record' | 'updated_record' | 'exact_duplicate' | 'duplicate_in_upload'
    old_values: jsonb('old_values'),
    new_values: jsonb('new_values').notNull(),
    natural_key_display: jsonb('natural_key_display'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('staging_session_type').on(t.ingestion_session_id, t.change_type)],
);

// ── Analytics read-model (computed after publish from canonical tables) ──────

export const memberWeekFacts = pmoSchema.table(
  'member_week_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id'),
    // Grain: one member × week
    member_id: text('member_id').notNull(),
    week_id: text('week_id').notNull(),
    scope_status: text('scope_status').notNull(), // IN_SCOPE | PRE_HIRE
    // Hours
    available_hours: real('available_hours').notNull(),
    planned_hours: real('planned_hours').notNull(),
    logged_hours: real('logged_hours').notNull(),
    expected_logged_hours: real('expected_logged_hours').notNull(),
    // Hours (computed, not nullable)
    billable_hours: real('billable_hours').notNull().default(0),
    bench_hours: real('bench_hours').notNull().default(0),
    overtime_hours: real('overtime_hours').notNull().default(0),
    training_hours: real('training_hours').notNull().default(0),
    // Metrics (nullable when denominator is zero)
    busy_rate: real('busy_rate'),
    utilization: real('utilization'),
    billable_rate: real('billable_rate'),
    bench_rate: real('bench_rate'),
    overtime_ratio: real('overtime_ratio'),
    effort_consumption: real('effort_consumption'),
    training_compliance: real('training_compliance'),
    // Classification
    rag_color: text('rag_color').notNull(), // green | yellow | red | none
    issue_type: text('issue_type').notNull(), // overbook|idle|mismatch_under|mismatch_over|ok
    computed_at: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('mwf_member_week_unique').on(t.tenant_id, t.member_id, t.week_id),
    index('mwf_tenant_issue').on(t.tenant_id, t.issue_type),
  ],
);

/** One freshness/version record per tenant for the persisted member-week read-model. */
export const memberWeekFactVersions = pmoSchema.table('member_week_fact_versions', {
  tenant_id: uuid('tenant_id').primaryKey(),
  facts_version: text('facts_version').notNull(),
  canonical_data_version: text('canonical_data_version').notNull(),
  facts_schema_version: text('facts_schema_version').notNull(),
  last_ingestion_session_id: uuid('last_ingestion_session_id'),
  computed_at: timestamp('computed_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Recommendation projections (synced from module public surfaces/events) ──

export const memberSkillsProjection = pmoSchema.table(
  'member_skills_projection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    member_id: text('member_id').notNull(),
    skill_key: text('skill_key').notNull(),
    skill_name: text('skill_name').notNull(),
    proficiency_level: integer('proficiency_level'),
    evidence_confidence: real('evidence_confidence').notNull().default(1),
    source: text('source').notNull(),
    source_version: text('source_version').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    observed_at: timestamp('observed_at', { withTimezone: true }).notNull(),
    synced_at: timestamp('synced_at', { withTimezone: true }).notNull(),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('member_skills_projection_idempotency').on(t.tenant_id, t.idempotency_key),
    index('member_skills_projection_member').on(t.tenant_id, t.member_id, t.is_active),
  ],
);

export const taskHistoryProjection = pmoSchema.table(
  'task_history_projection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    history_id: text('history_id').notNull(),
    member_id: text('member_id').notNull(),
    project_id: text('project_id'),
    allocation_role: text('allocation_role'),
    task_title: text('task_title').notNull(),
    task_summary: text('task_summary'),
    skill_tags: jsonb('skill_tags').$type<string[]>().notNull().default([]),
    completed_at: timestamp('completed_at', { withTimezone: true }).notNull(),
    evidence_confidence: real('evidence_confidence').notNull().default(1),
    embedding: jsonb('embedding').$type<number[]>(),
    embedding_model_id: text('embedding_model_id'),
    embedding_source_hash: text('embedding_source_hash'),
    source: text('source').notNull(),
    source_version: text('source_version').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    synced_at: timestamp('synced_at', { withTimezone: true }).notNull(),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('task_history_projection_idempotency').on(t.tenant_id, t.idempotency_key),
    index('task_history_projection_member_date').on(t.tenant_id, t.member_id, t.completed_at),
    index('task_history_projection_project').on(t.tenant_id, t.project_id),
  ],
);

// ── PMO report runs (generated after canonical publish) ─────────────────────

export const reportRuns = pmoSchema.table(
  'report_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    ingestion_session_id: uuid('ingestion_session_id'),
    source_mode: text('source_mode').notNull().default('canonical_db'),
    granularity: text('granularity').notNull().default('member_week'),
    filters: jsonb('filters').notNull().default({}),
    report_types: jsonb('report_types').notNull(),
    date_range_start: timestamp('date_range_start', { withTimezone: true }).notNull(),
    date_range_end: timestamp('date_range_end', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    rule_set_id: text('rule_set_id'),
    rule_version: text('rule_version'),
    rule_sha256: text('rule_sha256'),
    rule_snapshot: jsonb('rule_snapshot'),
    facts_computed_at: timestamp('facts_computed_at', { withTimezone: true }),
    facts_version: text('facts_version'),
    canonical_data_version: text('canonical_data_version'),
    recommendation_config_snapshot: jsonb('recommendation_config_snapshot'),
    embedding_model_id: text('embedding_model_id'),
    embedding_source_version: text('embedding_source_version'),
    result_summary: jsonb('result_summary'),
    result_payload: jsonb('result_payload'),
    html_s3_key: text('html_s3_key'),
    html_sha256: text('html_sha256'),
    html_size_bytes: bigint('html_size_bytes', { mode: 'number' }),
    pdf_s3_key: text('pdf_s3_key'),
    pdf_sha256: text('pdf_sha256'),
    pdf_size_bytes: bigint('pdf_size_bytes', { mode: 'number' }),
    pdf_page_count: integer('pdf_page_count'),
    failure_code: text('failure_code'),
    failure_message: text('failure_message'),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    created_by: uuid('created_by'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('report_runs_tenant_created').on(t.tenant_id, t.created_at),
    index('report_runs_ingestion_session').on(t.ingestion_session_id),
    index('report_runs_tenant_status').on(t.tenant_id, t.status, t.updated_at),
    check(
      'report_runs_status_check',
      sql`${t.status} IN ('queued','computing','rendering','completed','failed')`,
    ),
    check(
      'report_runs_source_mode_check',
      sql`${t.source_mode} IN ('canonical_db','after_upload_publish')`,
    ),
  ],
);
