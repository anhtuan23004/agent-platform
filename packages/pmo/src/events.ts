import { z } from 'zod';

export const PMO_EVENTS = {
  'pmo.ingestion.schema_detected': z.object({
    ingestion_session_id: z.string().uuid(),
    workbook_confidence: z.number(),
    table_count: z.number(),
  }),
  'pmo.ingestion.mapping_confirmed': z.object({
    ingestion_session_id: z.string().uuid(),
    confirmed_by: z.string().uuid(),
  }),
  'pmo.ingestion.staging_complete': z.object({
    ingestion_session_id: z.string().uuid(),
    change_summary: z.record(
      z.string(),
      z.object({
        new_records: z.number(),
        updated_records: z.number(),
        exact_duplicates: z.number(),
        duplicates_in_upload: z.number(),
      }),
    ),
    requires_review: z.boolean(),
  }),
  'pmo.ingestion.publish_approved': z.object({
    ingestion_session_id: z.string().uuid(),
    approved_by: z.string().uuid(),
  }),
  'pmo.ingestion.data_published': z.object({
    ingestion_session_id: z.string().uuid(),
    rows_written: z.record(z.string(), z.number()),
    rows_updated: z.record(z.string(), z.number()),
  }),
  'pmo.ingestion.failed': z.object({
    ingestion_session_id: z.string().uuid(),
    reason: z.string(),
  }),
  'pmo.report.requested': z.object({
    report_run_id: z.string().uuid(),
    status: z.literal('queued'),
    source_mode: z.enum(['canonical_db', 'after_upload_publish']),
    rule_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  'pmo.report.completed': z.object({
    report_run_id: z.string().uuid(),
    status: z.literal('completed'),
    member_count: z.number().int().nonnegative(),
    finding_count: z.number().int().nonnegative(),
    facts_version: z.string(),
  }),
  'pmo.report.failed': z.object({
    report_run_id: z.string().uuid(),
    status: z.literal('failed'),
    failure_code: z.string(),
  }),
} as const;
