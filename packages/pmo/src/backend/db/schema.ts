import {
  boolean,
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
    // Status lifecycle:
    // uploaded → profiling → awaiting_confirmation → confirmed → normalizing
    // → staging_normalized → awaiting_publish_review → published
    // Terminal: failed, rejected
    source_file_key: text('source_file_key').notNull(),
    source_file_name: text('source_file_name').notNull(),
    mime_type: text('mime_type').notNull(),
    // Reporting period (user selects at upload time)
    reporting_period_key: text('reporting_period_key'),
    reporting_period_start: timestamp('reporting_period_start', { withTimezone: true }),
    reporting_period_end: timestamp('reporting_period_end', { withTimezone: true }),
    // Schema inference results
    detected_schema: jsonb('detected_schema'),
    confirmed_mapping: jsonb('confirmed_mapping'),
    workbook_confidence: real('workbook_confidence'),
    change_summary: jsonb('change_summary'),
    // Publish audit
    publish_decision: text('publish_decision'),
    publish_reviewed_by: uuid('publish_reviewed_by'),
    publish_reviewed_at: timestamp('publish_reviewed_at', { withTimezone: true }),
    publish_review_note: text('publish_review_note'),
    // Lifecycle
    created_by: uuid('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
    finished_at: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('ingestion_sessions_tenant_status').on(t.tenant_id, t.status),
    index('ingestion_sessions_tenant_period').on(t.tenant_id, t.reporting_period_key),
  ],
);

// ── Canonical target tables (active merged data — upsert target) ────────────

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
    uniqueIndex('ra_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    uniqueIndex('ts_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    uniqueIndex('leave_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    uniqueIndex('proj_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    uniqueIndex('member_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    effective_date: timestamp('effective_date', { withTimezone: true }),
    // Metadata
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('config_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
    index('config_tenant_active').on(t.tenant_id, t.is_active),
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
    uniqueIndex('cal_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    uniqueIndex('kpi_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
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
    // Metrics (nullable when denominator is zero)
    busy_rate: real('busy_rate'),
    effort_consumption: real('effort_consumption'),
    utilization: real('utilization'),
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
