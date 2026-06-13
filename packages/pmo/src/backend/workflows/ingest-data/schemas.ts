import { ApprovalCardSchema } from '@seta/agent-sdk';
import { z } from 'zod';

// ── Workflow input ───────────────────────────────────────────────────────────

export const IngestInputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  fileKey: z.string(),
  tenantId: z.string().uuid().optional(),
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
  mappingOverride: MappingOverrideSchema.optional(),
  mappingOverrides: z.array(MappingOverrideSchema).optional(),
  note: z.string().optional(),
});

export const ConfirmOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  fileKey: z.string(),
  confirmedMappings: z.array(TableMappingSchema),
});

// ── Normalize to staging output ──────────────────────────────────────────────

export const NormalizeOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  rowsNormalized: z.record(z.string(), z.number()),
  status: z.enum(['success', 'partial', 'failed']),
});

// ── Staging & publish (HITL gate 2) ─────────────────────────────────────────

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
  sourceRow: z.number().int().positive(),
  field: z.string(),
  reason: z.string(),
});

export const StagingOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  changeSummary: z.array(ChangeSummaryTableSchema),
  blockingIssues: z.array(BlockingIssueSchema).default([]),
  hasBlockingIssues: z.boolean(),
  hasUpdates: z.boolean(),
  requiresReview: z.boolean(),
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
