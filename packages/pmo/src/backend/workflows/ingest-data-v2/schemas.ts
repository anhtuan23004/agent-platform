import { ApprovalCardSchema } from '@seta/agent-sdk';
import { z } from 'zod';

// ── Workflow input ───────────────────────────────────────────────────────────

export const IngestInputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  fileKey: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  /** Domain identifier (e.g. 'pmo'). Defaults to 'pmo' when omitted. */
  domainId: z.string().optional(),
  reportingPeriodKey: z.string().optional(),
  reportingPeriodStart: z.string().optional(),
  reportingPeriodEnd: z.string().optional(),
});

// ── Column mapping schemas ───────────────────────────────────────────────────

const ColumnMappingSchema = z.object({
  sourceColumn: z.string(),
  canonicalField: z.string(),
  confidence: z.number(),
  status: z.enum(['auto_accept', 'needs_review', 'blocked']),
  candidates: z
    .array(
      z.object({
        sourceColumn: z.string(),
        confidence: z.number(),
        blocked: z.boolean(),
      }),
    )
    .optional(),
});

const TableMappingSchema = z.object({
  tableId: z.string(),
  sourceSheet: z.string(),
  headerRow: z.number(),
  tableConfidence: z.number(),
  mappings: z.array(ColumnMappingSchema),
  unmappedRequired: z.array(z.string()),
  ambiguous: z.array(z.string()),
});

// ── Step outputs ─────────────────────────────────────────────────────────────

export const DetectOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  fileKey: z.string(),
  tableMappings: z.array(TableMappingSchema),
  validationStatus: z.enum(['confirmed', 'needs_review', 'blocked']),
  workbookConfidence: z.number(),
});

// ── Mapping confirmation (HITL gate 1) ───────────────────────────────────────

export const MappingCardSchema = ApprovalCardSchema;

const MappingOverrideSchema = z.object({
  tableId: z.string(),
  field: z.string(),
  sourceColumn: z.string(),
  confidence: z.number().optional(),
  blocked: z.boolean().optional(),
});

export const MappingDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'modify']),
  approvedItemKey: z.string().optional(),
  approvedItemKeys: z.array(z.string()).optional(),
  approvedByByItemKey: z.record(z.string(), z.string()).optional(),
  proceedToNextStep: z.boolean().optional(),
  mappingOverride: MappingOverrideSchema.optional(),
  mappingOverrides: z.array(MappingOverrideSchema).optional(),
  note: z.string().optional(),
});

const MappingReviewRowSchema = z.object({
  k: z.string(),
  v: z.string(),
});

export const ConfirmOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  fileKey: z.string(),
  confirmedMappings: z.array(TableMappingSchema),
  mappingReviewRows: z.array(MappingReviewRowSchema).default([]),
});

// ── Normalize to staging output ──────────────────────────────────────────────

export const NormalizeOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  rowsNormalized: z.record(z.string(), z.number()),
  status: z.enum(['success', 'partial', 'failed']),
});

// ── Staging & publish ───────────────────────────────────────────────────────

const ChangeSummaryTableSchema = z.object({
  tableId: z.string(),
  counts: z.object({
    new_records: z.number(),
    updated_records: z.number(),
    exact_duplicates: z.number(),
    duplicates_in_upload: z.number(),
  }),
  sampleChanges: z.array(
    z.object({
      type: z.enum(['new_record', 'updated_record', 'duplicate_in_upload']),
      naturalKey: z.record(z.string(), z.string()),
      oldValues: z.record(z.string(), z.unknown()).optional(),
      newValues: z.record(z.string(), z.unknown()),
    }),
  ),
});

const BlockingIssueSchema = z.object({
  tableId: z.string(),
  sourceSheet: z.string().optional(),
  sourceRow: z.number().int().positive(),
  field: z.string(),
  reason: z.string(),
});

const MemberMasterAdditionSchema = z.object({
  member_id: z.string().min(1),
  full_name: z.string().min(1),
  department: z.string().optional(),
  role_title: z.string().optional(),
  level: z.string().optional(),
  line_manager_id: z.string().optional(),
  employment_status: z.string().optional(),
  employment: z.string().optional(),
  std_hours_week: z.number().optional(),
});

export const StagingOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  changeSummary: z.array(ChangeSummaryTableSchema),
  blockingIssues: z.array(BlockingIssueSchema).default([]),
  mappingReviewRows: z.array(MappingReviewRowSchema).default([]),
  hasBlockingIssues: z.boolean(),
  hasUpdates: z.boolean(),
  requiresReview: z.boolean(),
});

export const NormalizationReviewCardSchema = ApprovalCardSchema;

export const NormalizationDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  memberMasterAdditions: z.array(MemberMasterAdditionSchema).optional(),
  rowDecisions: z
    .array(
      z.object({
        rowId: z.string(),
        decision: z.enum(['keep_row', 'skip_row']),
      }),
    )
    .optional(),
  rowOverrides: z
    .array(
      z.object({
        rowId: z.string(),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
  note: z.string().optional(),
});

export const PublishReviewCardSchema = ApprovalCardSchema;

export const PublishDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
});

export const PublishOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  rowsWritten: z.record(z.string(), z.number()),
  rowsUpdated: z.record(z.string(), z.number()),
  rowsSkipped: z.record(z.string(), z.number()),
  status: z.enum(['published', 'rejected']),
});

const ReportDateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ReportOutputSchema = z.object({
  dateRange: ReportDateRangeSchema,
  summary: z.object({
    memberCount: z.number().int(),
    overbookCount: z.number().int(),
    idleCount: z.number().int(),
    excludedWeekCount: z.number().int(),
  }),
  findings: z.array(z.record(z.string(), z.unknown())),
});

// ── Dynamic runtime v2 suspend/resume schemas ───────────────────────────────

export const DynamicPlannerResumeSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'modify']).optional(),
    plannerStepId: z.string().optional(),
    approvedItemKey: z.string().optional(),
    approvedItemKeys: z.array(z.string()).optional(),
    approvedByByItemKey: z.record(z.string(), z.string()).optional(),
    proceedToNextStep: z.boolean().optional(),
    mappingOverride: MappingOverrideSchema.optional(),
    mappingOverrides: z.array(MappingOverrideSchema).optional(),
    memberMasterAdditions: z.array(MemberMasterAdditionSchema).optional(),
    dateRange: ReportDateRangeSchema.optional(),
    workloadDateRange: ReportDateRangeSchema.optional(),
    forwardAllocationDateRange: ReportDateRangeSchema.optional(),
    dateRangeStrategy: z.enum(['sheet_derived', 'manual_database']).optional(),
    note: z.string().optional(),
  })
  .passthrough();

export const DynamicPlannerSuspendSchema = ApprovalCardSchema;

export const IngestDataV2InputSchema = IngestInputSchema;

export const IngestDataV2OutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  status: z.enum(['published', 'rejected', 'completed']),
  rowsWritten: z.record(z.string(), z.number()).default({}),
  rowsUpdated: z.record(z.string(), z.number()).default({}),
  rowsSkipped: z.record(z.string(), z.number()).default({}),
  reportRunId: z.string().uuid().nullable().optional(),
  reportRunIds: z.array(z.string().uuid()).optional(),
  report: ReportOutputSchema.optional(),
});

export type DynamicPlannerResume = z.infer<typeof DynamicPlannerResumeSchema>;
export type IngestDataV2Output = z.infer<typeof IngestDataV2OutputSchema>;
