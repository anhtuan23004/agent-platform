import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SessionEnv } from '@seta/core';
import { buildTenantKey, presignedUploadUrl } from '@seta/shared-storage';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import { createS3FileStore } from '../ingestion/s3-file-store.ts';
import { generatePmoWorkflowPlan } from '../planning/generate-plan.ts';
import { readPlannerWorkflowSteps } from '../planning/step-metadata.ts';
import {
  applyProfilingReviewOverrides,
  applyWaivedMissingAreas,
  buildWorkbookProfilingSessionSummary,
  deriveCurrentProfilingStepStatus,
  type KnownProfilingArea,
  type ProfilingReviewState,
  type ProfilingSheetReviewOverride,
  runWorkbookProfiling,
  type SessionDocumentProfileRecord,
  type WorkflowExecutionState,
  type WorkflowExecutionStep,
} from '../profiling/workbook-profiling.ts';

type PlanningState = 'uploaded' | 'generating_plan' | 'plan_review' | 'approved_plan';
type ProfilingStepStatus = 'in_progress' | 'needs_review' | 'completed' | 'failed';

interface ProposedWorkflowStep {
  step_no: number;
  planner_step_id?: string;
  action_id?: string;
  review_type?: string;
  step_name: string;
}

function asIso(input: Date | string | null | undefined): string {
  if (!input) {
    return new Date().toISOString();
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function asIsoOrNull(input: Date | string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function asDateOrNull(input: string | null | undefined): Date | null {
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatFileSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) {
    return '0 B';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readPlanningState(rawStatus: string): PlanningState {
  if (rawStatus === 'uploaded') return 'uploaded';
  if (rawStatus === 'approved_plan') return 'approved_plan';
  if (rawStatus === 'plan_review') return 'plan_review';
  if (rawStatus === 'generating_plan') return 'generating_plan';
  // Any non-planning runtime status is already beyond plan generation.
  return 'approved_plan';
}

function mapHistoryStatus(state: PlanningState): {
  label: string;
  active_gate: string;
  progress_text: string;
  progress_pct: number;
} {
  if (state === 'uploaded') {
    return {
      label: 'Uploaded',
      active_gate: 'Analyze and generate plan',
      progress_text: '0 / 3 (0%)',
      progress_pct: 0,
    };
  }

  if (state === 'generating_plan') {
    return {
      label: 'Generating plan',
      active_gate: 'Analyze and generate plan',
      progress_text: '1 / 3 (33%)',
      progress_pct: 33,
    };
  }

  if (state === 'plan_review') {
    return {
      label: 'Plan review',
      active_gate: 'Plan review',
      progress_text: '2 / 3 (67%)',
      progress_pct: 67,
    };
  }

  return {
    label: 'Approved',
    active_gate: 'Approved and moved next step',
    progress_text: '3 / 3 (100%)',
    progress_pct: 100,
  };
}

function readProposedWorkflow(plan: unknown): ProposedWorkflowStep[] {
  return readPlannerWorkflowSteps(plan).map((step) => ({
    step_no: step.step_no,
    planner_step_id: step.planner_step_id,
    action_id: step.action_id,
    review_type: step.review_type,
    step_name: step.step_name,
  }));
}

function normalizeKnownProfilingArea(area: unknown): KnownProfilingArea | null {
  if (
    area === 'resource_allocation' ||
    area === 'timesheet' ||
    area === 'overbook_idle_config' ||
    area === 'member_master' ||
    area === 'project_master' ||
    area === 'leave' ||
    area === 'calendar_weeks' ||
    area === 'kpi_norms'
  ) {
    return area;
  }

  if (area === 'holiday') {
    return 'calendar_weeks';
  }

  return null;
}

function normalizeProfilingSummary(raw: unknown): WorkflowExecutionState['profiling_summary'] {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const summary = raw as {
    generated_at?: unknown;
    document_count?: unknown;
    profiled_document_count?: unknown;
    total_sheet_count?: unknown;
    total_row_count?: unknown;
    detected_data_areas?: unknown;
    missing_recommended_data_areas?: unknown;
    missing_recommended_data_areas_details?: unknown;
    likely_ignorable_sheets?: unknown;
  };

  const detectedDataAreas = Array.isArray(summary.detected_data_areas)
    ? [
        ...new Set(
          summary.detected_data_areas
            .map((area) => normalizeKnownProfilingArea(area))
            .filter((area): area is KnownProfilingArea => Boolean(area)),
        ),
      ]
    : [];

  return {
    generated_at:
      typeof summary.generated_at === 'string' && summary.generated_at.trim().length > 0
        ? summary.generated_at
        : new Date().toISOString(),
    document_count: typeof summary.document_count === 'number' ? summary.document_count : 0,
    profiled_document_count:
      typeof summary.profiled_document_count === 'number' ? summary.profiled_document_count : 0,
    total_sheet_count:
      typeof summary.total_sheet_count === 'number' ? summary.total_sheet_count : 0,
    total_row_count: typeof summary.total_row_count === 'number' ? summary.total_row_count : 0,
    detected_data_areas: detectedDataAreas,
    missing_recommended_data_areas: [],
    missing_recommended_data_areas_details: [],
    likely_ignorable_sheets: Array.isArray(summary.likely_ignorable_sheets)
      ? summary.likely_ignorable_sheets.filter((item): item is string => typeof item === 'string')
      : [],
    suggested_next_step:
      'Workbook profiling complete. Confirm sheet roles, then continue to validation.',
  };
}

function readDocuments(raw: unknown): SessionDocumentProfileRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry): SessionDocumentProfileRecord | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const doc = entry as Partial<SessionDocumentProfileRecord>;
      if (
        typeof doc.document_id !== 'string' ||
        typeof doc.source_file_key !== 'string' ||
        typeof doc.file_name !== 'string' ||
        typeof doc.mime_type !== 'string' ||
        typeof doc.uploaded_at !== 'string' ||
        (doc.status !== 'uploaded' &&
          doc.status !== 'profiling' &&
          doc.status !== 'profiled' &&
          doc.status !== 'profile_failed')
      ) {
        return null;
      }

      return {
        document_id: doc.document_id,
        source_file_key: doc.source_file_key,
        file_name: doc.file_name,
        file_size_bytes: typeof doc.file_size_bytes === 'number' ? doc.file_size_bytes : null,
        mime_type: doc.mime_type,
        uploaded_at: doc.uploaded_at,
        status: doc.status,
        profile_result: doc.profile_result,
        error_message: typeof doc.error_message === 'string' ? doc.error_message : undefined,
      };
    })
    .filter((doc): doc is SessionDocumentProfileRecord => Boolean(doc));
}

function readExecutionState(raw: unknown): WorkflowExecutionState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const state = raw as WorkflowExecutionState;

  return {
    ...state,
    profiling_summary: normalizeProfilingSummary(state.profiling_summary),
  };
}

function ensureExecutionSteps(plan: unknown): WorkflowExecutionStep[] {
  const proposed = readProposedWorkflow(plan);
  if (proposed.length === 0) {
    return [
      {
        step_no: 1,
        planner_step_id: 'pmo.planner.step.1.workbook_profiling',
        action_id: 'workbook_profiling',
        review_type: 'profiling',
        step_name: 'Workbook Profiling',
        status: 'in_progress',
      },
    ];
  }

  return proposed.map((step, index) => ({
    step_no: step.step_no,
    planner_step_id: step.planner_step_id,
    action_id: step.action_id,
    review_type: step.review_type,
    step_name: step.step_name,
    status: index === 0 ? 'in_progress' : 'pending',
  }));
}

function findProfilingStepNo(steps: WorkflowExecutionStep[]): number {
  const profilingStep = steps.find((step) => /workbook\s*profil/i.test(step.step_name));
  if (profilingStep) {
    return profilingStep.step_no;
  }

  if (steps.length === 0) {
    return 1;
  }

  return steps.reduce((min, step) => Math.min(min, step.step_no), Number.POSITIVE_INFINITY);
}

function setProfilingStepStatus(
  steps: WorkflowExecutionStep[],
  profilingStepNo: number,
  status: ProfilingStepStatus,
): WorkflowExecutionStep[] {
  let hasProfilingStep = false;
  const mapped = steps.map((step) => {
    if (step.step_no !== profilingStepNo) {
      return step;
    }

    hasProfilingStep = true;
    return {
      ...step,
      status,
    };
  });

  if (hasProfilingStep) {
    return mapped;
  }

  return [
    {
      step_no: profilingStepNo,
      planner_step_id: 'pmo.planner.step.1.workbook_profiling',
      action_id: 'workbook_profiling',
      review_type: 'profiling',
      step_name: 'Workbook Profiling',
      status,
    },
    ...mapped,
  ];
}

function markStepsBeforeAsCompleted(
  steps: WorkflowExecutionStep[],
  stepNo: number,
): WorkflowExecutionStep[] {
  return steps.map((step) => {
    if (step.step_no < stepNo) {
      return {
        ...step,
        status: step.status === 'failed' ? 'failed' : 'completed',
      };
    }

    return step;
  });
}

function cancelOpenWorkflowSteps(steps: WorkflowExecutionStep[]): WorkflowExecutionStep[] {
  return steps.map((step) => {
    if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled') {
      return step;
    }

    return {
      ...step,
      status: 'cancelled',
    };
  });
}

function markLaterCompletedStepsNeedsReview(
  steps: WorkflowExecutionStep[],
  fromStepNo: number,
): WorkflowExecutionStep[] {
  return steps.map((step) => {
    if (step.step_no > fromStepNo && step.status === 'completed') {
      return {
        ...step,
        status: 'needs_review',
      };
    }

    return step;
  });
}

function createInitialExecutionState(plan: unknown, nowIso: string): WorkflowExecutionState {
  const steps = ensureExecutionSteps(plan);
  const firstStepNo = steps.slice().sort((a, b) => a.step_no - b.step_no)[0]?.step_no ?? 1;
  return {
    state_version: 1,
    started_at: nowIso,
    updated_at: nowIso,
    current_step_no: firstStepNo,
    current_step_status: 'in_progress',
    steps,
    documents: [],
    profiling_summary: null,
    profiling_review: null,
  };
}

function buildPrimaryDocumentRecord(params: {
  source_file_key: string;
  source_file_name: string;
  source_file_size_bytes: number | null;
  mime_type: string;
  uploaded_at: Date | string | null;
}): SessionDocumentProfileRecord {
  return {
    document_id: crypto.randomUUID(),
    source_file_key: params.source_file_key,
    file_name: params.source_file_name,
    file_size_bytes: params.source_file_size_bytes,
    mime_type: params.mime_type,
    uploaded_at: asIso(params.uploaded_at),
    status: 'profiling',
  };
}

async function runSingleDocumentProfiling(params: {
  goal: string;
  document: SessionDocumentProfileRecord;
}): Promise<SessionDocumentProfileRecord> {
  const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
  const fileStore = createS3FileStore(bucket);

  try {
    const buffer = await fileStore.getBuffer(params.document.source_file_key);
    const profileResult = await runWorkbookProfiling({
      goal: params.goal,
      fileBuffer: buffer,
      fileName: params.document.file_name,
      fileSizeBytes: params.document.file_size_bytes,
      mimeType: params.document.mime_type,
      uploadedAt: params.document.uploaded_at,
    });

    return {
      ...params.document,
      status: 'profiled',
      profile_result: profileResult,
      error_message: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[pmo/profiling] document profiling failed:', message, error);

    return {
      ...params.document,
      status: 'profile_failed',
      error_message: message,
    };
  }
}

function finalizeExecutionStateAfterProfiling(params: {
  baseState: WorkflowExecutionState;
  documents: SessionDocumentProfileRecord[];
  nowIso: string;
}): WorkflowExecutionState {
  const profilingStepNo = findProfilingStepNo(params.baseState.steps);
  const summary = buildWorkbookProfilingSessionSummary(params.documents);
  const profilingStatus = deriveCurrentProfilingStepStatus(params.documents);
  const nextStatus: ProfilingStepStatus = profilingStatus === 'failed' ? 'failed' : 'needs_review';
  const stepsBeforeCompleted = markStepsBeforeAsCompleted(params.baseState.steps, profilingStepNo);
  const reviewedSteps = markLaterCompletedStepsNeedsReview(stepsBeforeCompleted, profilingStepNo);
  const steps = setProfilingStepStatus(reviewedSteps, profilingStepNo, nextStatus);
  const currentReviewState = params.baseState.profiling_review;
  const reviewState: ProfilingReviewState =
    currentReviewState && currentReviewState.status === 'approved'
      ? {
          ...currentReviewState,
          status: 'needs_review',
          approved_at: undefined,
          approved_by: undefined,
          last_updated_at: params.nowIso,
        }
      : {
          ...(currentReviewState ?? createDefaultProfilingReviewState(params.nowIso)),
          status: 'needs_review',
          last_updated_at: params.nowIso,
        };

  return {
    ...params.baseState,
    updated_at: params.nowIso,
    current_step_no: profilingStepNo,
    current_step_status: nextStatus,
    steps,
    documents: params.documents,
    profiling_summary: summary,
    profiling_review: reviewState,
  };
}

function readCurrentStepName(executionState: WorkflowExecutionState): string {
  return (
    executionState.steps.find((step) => step.step_no === executionState.current_step_no)
      ?.step_name ?? 'Workbook Profiling'
  );
}

function mapExecutionHistoryStatus(executionState: WorkflowExecutionState | null): {
  label: string;
  active_gate: string;
  progress_text: string;
  progress_pct: number;
} | null {
  if (!executionState || executionState.steps.length === 0) {
    return null;
  }

  const total = executionState.steps.length;
  const completed = executionState.steps.filter((step) => step.status === 'completed').length;
  const isCancelled =
    executionState.current_step_status === 'cancelled' ||
    executionState.steps.some((step) => step.status === 'cancelled');
  const failedStep = executionState.steps.find((step) => step.status === 'failed');
  const currentStep = executionState.steps.find((step) => step.status === 'in_progress');
  const progressPct = Math.round((completed / total) * 100);

  if (isCancelled) {
    return {
      label: 'Cancelled',
      active_gate: 'Workflow cancelled',
      progress_text: `${completed} / ${total} workflow steps`,
      progress_pct: progressPct,
    };
  }

  if (failedStep) {
    return {
      label: 'Execution blocked',
      active_gate: failedStep.step_name,
      progress_text: `${completed} / ${total} workflow steps`,
      progress_pct: progressPct,
    };
  }

  if (completed >= total) {
    return {
      label: 'Execution completed',
      active_gate: 'All workflow steps completed',
      progress_text: `${total} / ${total} workflow steps`,
      progress_pct: 100,
    };
  }

  if (currentStep) {
    return {
      label: 'Executing',
      active_gate: currentStep.step_name,
      progress_text: `${completed} / ${total} workflow steps`,
      progress_pct: progressPct,
    };
  }

  return {
    label: 'Awaiting next step',
    active_gate: readCurrentStepName(executionState),
    progress_text: `${completed} / ${total} workflow steps`,
    progress_pct: progressPct,
  };
}

const PlanGenerateRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
  goal: z.string().trim().min(1).max(4000),
  plan_feedback: z.string().trim().max(4000).optional(),
  previous_plan: z.unknown().optional(),
});

const PlanApproveRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
});

const WorkflowCancelRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
});

// ── Types ────────────────────────────────────────────────────────────────────

const UploadRequestSchema = z.object({
  filename: z.string().min(1),
  file_size_bytes: z.number().int().nonnegative().optional(),
  mime_type: z
    .string()
    .default('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  reporting_period_key: z.string().optional(),
});

const AppendUploadRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
});

const ProfilingSheetOverrideSchema = z.object({
  document_id: z.string().uuid(),
  sheet_name: z.string().trim().min(1),
  final_area: z.enum([
    'resource_allocation',
    'timesheet',
    'overbook_idle_config',
    'member_master',
    'project_master',
    'leave',
    'calendar_weeks',
    'kpi_norms',
    'unknown',
  ]),
  mark_ignore: z.boolean().optional(),
});

const ProfilingReviewUpsertSchema = z.object({
  ingestion_session_id: z.string().uuid(),
  sheet_overrides: z.array(ProfilingSheetOverrideSchema).optional(),
  waived_missing_areas: z
    .array(
      z.enum([
        'resource_allocation',
        'timesheet',
        'overbook_idle_config',
        'member_master',
        'project_master',
        'leave',
        'calendar_weeks',
        'kpi_norms',
      ]),
    )
    .optional(),
});

const ProfilingApproveContinueSchema = z.object({
  ingestion_session_id: z.string().uuid(),
});

function createDefaultProfilingReviewState(nowIso: string): ProfilingReviewState {
  return {
    status: 'needs_review',
    sheet_overrides: [],
    waived_missing_areas: [],
    last_updated_at: nowIso,
  };
}

function readProfilingReviewState(raw: unknown): ProfilingReviewState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<ProfilingReviewState>;
  const status = value.status === 'approved' ? 'approved' : 'needs_review';

  const sheetOverrides = Array.isArray(value.sheet_overrides)
    ? value.sheet_overrides.filter(
        (item): item is ProfilingSheetReviewOverride =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof item.document_id === 'string' &&
          typeof item.sheet_name === 'string' &&
          typeof item.final_area === 'string' &&
          typeof item.mark_ignore === 'boolean',
      )
    : [];

  const waivedMissingAreas = Array.isArray(value.waived_missing_areas)
    ? value.waived_missing_areas.filter(
        (area): area is KnownProfilingArea =>
          area === 'resource_allocation' ||
          area === 'timesheet' ||
          area === 'overbook_idle_config' ||
          area === 'member_master' ||
          area === 'project_master' ||
          area === 'leave' ||
          area === 'calendar_weeks' ||
          area === 'kpi_norms',
      )
    : [];

  return {
    status,
    sheet_overrides: sheetOverrides,
    waived_missing_areas: waivedMissingAreas,
    last_updated_at:
      typeof value.last_updated_at === 'string' ? value.last_updated_at : new Date().toISOString(),
    approved_at: typeof value.approved_at === 'string' ? value.approved_at : undefined,
    approved_by: typeof value.approved_by === 'string' ? value.approved_by : undefined,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function buildPmoRoutes(): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();

  // POST /api/pmo/v1/upload-url
  // Returns a presigned S3 URL for the client to upload the Excel file,
  // plus an ingestion_session_id to track the upload.
  app.post('/api/pmo/v1/upload-url', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = UploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { filename, file_size_bytes, mime_type, reporting_period_key } = parsed.data;
    const sessionId = crypto.randomUUID();

    // Build S3 key
    const s3Key = buildTenantKey({
      tenant_id: session.tenant_id,
      domain: 'pmo',
      file_id: sessionId,
      filename,
    });

    // Insert ingestion session
    const db = pmoDb();
    await db.insert(ingestionSessions).values({
      id: sessionId,
      tenant_id: session.tenant_id,
      status: 'uploaded',
      source_file_key: s3Key,
      source_file_name: filename,
      source_file_size_bytes: file_size_bytes ?? null,
      mime_type,
      reporting_period_key: reporting_period_key ?? null,
      created_by: session.user_id,
    });

    // Generate presigned upload URL
    const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
    const upload_url = await presignedUploadUrl({
      bucket,
      key: s3Key,
      contentType: mime_type,
      expiresInSeconds: 15 * 60,
    });

    return c.json({
      ingestion_session_id: sessionId,
      upload_url,
      s3_key: s3Key,
      filename,
    });
  });

  // POST /api/pmo/v1/upload-complete
  // Called after client uploads file to S3. Returns canonical payload to start
  // pmo.ingestData via /api/agent/v1/workflows/runs/pmo.ingestData/start.
  app.post('/api/pmo/v1/upload-complete', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { ingestion_session_id } = body as { ingestion_session_id?: string };

    if (!ingestion_session_id) {
      return c.json({ error: 'ingestion_session_id required' }, 400);
    }

    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        source_file_key: ingestionSessions.source_file_key,
        reporting_period_key: ingestionSessions.reporting_period_key,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    return c.json({
      status: 'uploaded',
      ingestion_session_id: row.id,
      file_key: row.source_file_key,
      reporting_period_key: row.reporting_period_key,
      start_payload: {
        ingestionSessionId: row.id,
        fileKey: row.source_file_key,
        reportingPeriodKey: row.reporting_period_key ?? undefined,
      },
      message:
        'Upload recorded. Start workflow via /api/agent/v1/workflows/runs/pmo.ingestData/start.',
    });
  });

  // POST /api/pmo/v1/upload
  // Proxy upload: client sends file as multipart, server uploads to S3.
  // Bypasses CORS issues with direct-to-S3 presigned URLs.
  app.post('/api/pmo/v1/upload', async (c) => {
    try {
      const session = c.get('user');
      const body = await c.req.parseBody();
      const file = body.file;

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'file field required (multipart)' }, 400);
      }

      const filename = file.name || 'upload.xlsx';
      const reportingPeriodKey = (body.reporting_period_key as string) || undefined;
      const sessionId = crypto.randomUUID();
      const mime_type =
        file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const sizeBytes = Number.isFinite(file.size) ? file.size : null;

      // Build S3 key
      const s3Key = buildTenantKey({
        tenant_id: session.tenant_id,
        domain: 'pmo',
        file_id: sessionId,
        filename,
      });

      // Upload to S3
      const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
      const region = process.env.S3_REGION ?? 'ap-southeast-1';
      const s3 = new S3Client({ region });
      const buffer = Buffer.from(await file.arrayBuffer());
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: mime_type,
        }),
      );

      // Insert ingestion session
      const db = pmoDb();
      await db.insert(ingestionSessions).values({
        id: sessionId,
        tenant_id: session.tenant_id,
        status: 'uploaded',
        source_file_key: s3Key,
        source_file_name: filename,
        source_file_size_bytes: sizeBytes,
        mime_type,
        reporting_period_key: reportingPeriodKey ?? null,
        created_by: session.user_id,
      });

      return c.json({
        ingestion_session_id: sessionId,
        s3_key: s3Key,
        status: 'uploaded',
        start_payload: {
          ingestionSessionId: sessionId,
          fileKey: s3Key,
          reportingPeriodKey: reportingPeriodKey,
        },
        message:
          'File uploaded. Start workflow via /api/agent/v1/workflows/runs/pmo.ingestData/start.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[pmo/upload] error:', message, err);
      return c.json({ error: 'upload_failed', message }, 500);
    }
  });

  // GET /api/pmo/v1/ingestion-sessions
  // Returns latest sessions with planning status for frontend history and resume.
  app.get('/api/pmo/v1/ingestion-sessions', async (c) => {
    const session = c.get('user');
    const db = pmoDb();

    const rows = await db
      .select({
        id: ingestionSessions.id,
        source_file_name: ingestionSessions.source_file_name,
        source_file_size_bytes: ingestionSessions.source_file_size_bytes,
        mime_type: ingestionSessions.mime_type,
        status: ingestionSessions.status,
        planning_goal: ingestionSessions.planning_goal,
        planning_plan: ingestionSessions.planning_plan,
        planning_plan_version: ingestionSessions.planning_plan_version,
        planning_feedback_history: ingestionSessions.planning_feedback_history,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
        profiling_documents: ingestionSessions.profiling_documents,
        profiling_summary: ingestionSessions.profiling_summary,
        profiling_review: ingestionSessions.workflow_execution_state,
        workflow_current_step: ingestionSessions.workflow_current_step,
        workflow_step_status: ingestionSessions.workflow_step_status,
        workflow_started_at: ingestionSessions.workflow_started_at,
        workflow_updated_at: ingestionSessions.workflow_updated_at,
        created_by: ingestionSessions.created_by,
        created_at: ingestionSessions.created_at,
        planning_last_generated_at: ingestionSessions.planning_last_generated_at,
        planning_approved_at: ingestionSessions.planning_approved_at,
      })
      .from(ingestionSessions)
      .where(eq(ingestionSessions.tenant_id, session.tenant_id))
      .orderBy(ingestionSessions.created_at)
      .limit(100);

    const mapped = rows
      .slice()
      .reverse()
      .map((row) => {
        const executionState = readExecutionState(row.workflow_execution_state);
        const planningState = readPlanningState(row.status);
        const history =
          mapExecutionHistoryStatus(executionState) ?? mapHistoryStatus(planningState);

        return {
          ingestion_session_id: row.id,
          workbook_name: row.source_file_name,
          workbook_size_bytes: row.source_file_size_bytes ?? 0,
          workbook_size: formatFileSize(row.source_file_size_bytes ?? 0),
          file_type: row.mime_type,
          uploaded_at: asIso(row.created_at),
          operator: row.created_by,
          planning_state: planningState,
          status_label: history.label,
          active_gate: history.active_gate,
          progress_text: history.progress_text,
          progress_pct: history.progress_pct,
          goal: row.planning_goal ?? '',
          plan: row.planning_plan,
          plan_version: row.planning_plan_version ?? 0,
          feedback_history: Array.isArray(row.planning_feedback_history)
            ? row.planning_feedback_history
            : [],
          execution_state: executionState,
          profiling_documents: readDocuments(row.profiling_documents),
          profiling_summary:
            executionState?.profiling_summary ?? normalizeProfilingSummary(row.profiling_summary),
          profiling_review: readProfilingReviewState(executionState?.profiling_review),
          workflow_current_step:
            row.workflow_current_step ??
            executionState?.steps.find((step) => step.step_no === executionState.current_step_no)
              ?.step_name ??
            null,
          workflow_step_status:
            row.workflow_step_status ?? executionState?.current_step_status ?? null,
          workflow_started_at:
            asIsoOrNull(row.workflow_started_at) ?? executionState?.started_at ?? null,
          workflow_updated_at:
            asIsoOrNull(row.workflow_updated_at) ?? executionState?.updated_at ?? null,
          plan_generated_at: row.planning_last_generated_at
            ? asIso(row.planning_last_generated_at)
            : null,
          plan_approved_at: row.planning_approved_at ? asIso(row.planning_approved_at) : null,
        };
      });

    return c.json({ items: mapped });
  });

  // POST /api/pmo/v1/plan/generate
  // Generates or regenerates a planning draft using Goal + file metadata.
  app.post('/api/pmo/v1/plan/generate', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = PlanGenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id, goal, previous_plan, plan_feedback } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        source_file_name: ingestionSessions.source_file_name,
        source_file_size_bytes: ingestionSessions.source_file_size_bytes,
        mime_type: ingestionSessions.mime_type,
        created_at: ingestionSessions.created_at,
        status: ingestionSessions.status,
        planning_plan_version: ingestionSessions.planning_plan_version,
        planning_feedback_history: ingestionSessions.planning_feedback_history,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const currentState = readPlanningState(row.status);
    if (currentState === 'approved_plan') {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Approved plan cannot be regenerated in this phase.',
        },
        409,
      );
    }

    await db
      .update(ingestionSessions)
      .set({
        status: 'generating_plan',
        planning_goal: goal,
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    const effectiveFeedback = plan_feedback?.trim() || '';
    const effectivePreviousPlan = previous_plan ?? null;

    try {
      const plan = await generatePmoWorkflowPlan({
        goal,
        uploaded_file: {
          file_name: row.source_file_name,
          file_size: formatFileSize(row.source_file_size_bytes ?? 0),
          uploaded_at: asIso(row.created_at),
          file_type: row.mime_type,
        },
        workflow_capabilities: {
          can_parse_excel_workbook: true,
          can_detect_sheet_roles: true,
          can_propose_column_mappings: true,
          can_normalize_to_staging: true,
          can_compare_with_existing_database: true,
          can_generate_db_change_summary: true,
          can_publish_after_user_approval: true,
        },
        previous_plan: effectivePreviousPlan,
        ...(effectiveFeedback ? { plan_feedback: effectiveFeedback } : {}),
      });

      const existingFeedback = Array.isArray(row.planning_feedback_history)
        ? row.planning_feedback_history
        : [];
      const nextFeedback = effectiveFeedback
        ? [...existingFeedback, effectiveFeedback]
        : existingFeedback;
      const nextVersion = (row.planning_plan_version ?? 0) + 1;

      await db
        .update(ingestionSessions)
        .set({
          status: 'plan_review',
          planning_goal: goal,
          planning_plan: plan,
          planning_plan_version: nextVersion,
          planning_feedback_history: nextFeedback,
          planning_last_generated_at: new Date(),
        })
        .where(
          and(
            eq(ingestionSessions.id, ingestion_session_id),
            eq(ingestionSessions.tenant_id, session.tenant_id),
          ),
        );

      return c.json({
        ingestion_session_id,
        planning_state: 'plan_review' as const,
        plan,
        plan_version: nextVersion,
        feedback_history: nextFeedback,
      });
    } catch (err) {
      await db
        .update(ingestionSessions)
        .set({
          status: currentState,
        })
        .where(
          and(
            eq(ingestionSessions.id, ingestion_session_id),
            eq(ingestionSessions.tenant_id, session.tenant_id),
          ),
        );

      const message = err instanceof Error ? err.message : String(err);
      console.error('[pmo/plan/generate] error:', message, err);
      return c.json({ error: 'plan_generation_failed', message }, 500);
    }
  });

  // POST /api/pmo/v1/plan/approve
  // Approves current plan and moves to next workflow step marker.
  app.post('/api/pmo/v1/plan/approve', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = PlanApproveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        status: ingestionSessions.status,
        planning_plan: ingestionSessions.planning_plan,
        planning_goal: ingestionSessions.planning_goal,
        source_file_key: ingestionSessions.source_file_key,
        source_file_name: ingestionSessions.source_file_name,
        source_file_size_bytes: ingestionSessions.source_file_size_bytes,
        mime_type: ingestionSessions.mime_type,
        created_at: ingestionSessions.created_at,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
        profiling_documents: ingestionSessions.profiling_documents,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const state = readPlanningState(row.status);
    if (state !== 'plan_review') {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Only plan_review state can be approved.',
        },
        409,
      );
    }

    if (!row.planning_plan) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Cannot approve before a plan exists.',
        },
        409,
      );
    }

    const nowIso = new Date().toISOString();
    const goal = row.planning_goal?.trim() || 'Profile workbook for PMO ingestion workflow.';

    const existingExecutionState = readExecutionState(row.workflow_execution_state);
    const hasExistingDocuments = readDocuments(row.profiling_documents);

    let nextExecutionState = existingExecutionState;
    if (!nextExecutionState) {
      nextExecutionState = createInitialExecutionState(row.planning_plan, nowIso);
    }

    let nextDocuments =
      nextExecutionState.documents.length > 0
        ? [...nextExecutionState.documents]
        : [...hasExistingDocuments];

    if (nextDocuments.length === 0) {
      nextDocuments = [
        buildPrimaryDocumentRecord({
          source_file_key: row.source_file_key,
          source_file_name: row.source_file_name,
          source_file_size_bytes: row.source_file_size_bytes,
          mime_type: row.mime_type,
          uploaded_at: row.created_at,
        }),
      ];
    }

    nextDocuments = await Promise.all(
      nextDocuments.map(async (document) => {
        if (document.status !== 'uploaded' && document.status !== 'profiling') {
          return document;
        }

        return runSingleDocumentProfiling({
          goal,
          document: {
            ...document,
            status: 'profiling',
          },
        });
      }),
    );

    nextExecutionState = finalizeExecutionStateAfterProfiling({
      baseState: {
        ...nextExecutionState,
        started_at: nextExecutionState.started_at || nowIso,
      },
      documents: nextDocuments,
      nowIso,
    });

    await db
      .update(ingestionSessions)
      .set({
        status: 'approved_plan',
        planning_approved_at: asDateOrNull(nowIso),
        workflow_execution_state: nextExecutionState,
        profiling_documents: nextExecutionState.documents,
        profiling_summary: nextExecutionState.profiling_summary,
        workflow_current_step: readCurrentStepName(nextExecutionState),
        workflow_step_status: nextExecutionState.current_step_status,
        workflow_started_at: asDateOrNull(nextExecutionState.started_at),
        workflow_updated_at: asDateOrNull(nextExecutionState.updated_at),
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    return c.json({
      ingestion_session_id,
      planning_state: 'approved_plan' as const,
      approved_at: nowIso,
      execution_state: nextExecutionState,
      profiling_documents: nextExecutionState.documents,
      profiling_summary: nextExecutionState.profiling_summary,
      profiling_review: nextExecutionState.profiling_review,
    });
  });

  // POST /api/pmo/v1/workflow/cancel
  // Cancels a currently running workflow execution.
  app.post('/api/pmo/v1/workflow/cancel', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = WorkflowCancelRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const executionState = readExecutionState(row.workflow_execution_state);
    if (!executionState || executionState.steps.length === 0) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Workflow is not started or has no execution steps.',
        },
        409,
      );
    }

    if (
      executionState.current_step_status === 'completed' ||
      executionState.current_step_status === 'failed' ||
      executionState.current_step_status === 'cancelled'
    ) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Workflow is already completed, failed, or cancelled.',
        },
        409,
      );
    }

    const nowIso = new Date().toISOString();
    const nextExecutionState: WorkflowExecutionState = {
      ...executionState,
      updated_at: nowIso,
      current_step_status: 'cancelled',
      steps: cancelOpenWorkflowSteps(executionState.steps),
    };

    await db
      .update(ingestionSessions)
      .set({
        workflow_execution_state: nextExecutionState,
        workflow_current_step: 'Workflow cancelled',
        workflow_step_status: 'cancelled',
        workflow_updated_at: asDateOrNull(nextExecutionState.updated_at),
        finished_at: asDateOrNull(nowIso),
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    return c.json({
      ingestion_session_id,
      cancelled_at: nowIso,
      execution_state: nextExecutionState,
      workflow_current_step: 'Workflow cancelled',
      workflow_step_status: 'cancelled' as const,
    });
  });

  // POST /api/pmo/v1/ingestion-sessions/:id/documents/upload
  // Appends a supplemental workbook into an existing ingestion session and
  // profiles only that new document while preserving current workflow state.
  app.post('/api/pmo/v1/ingestion-sessions/:id/documents/upload', async (c) => {
    try {
      const session = c.get('user');
      const paramsId = c.req.param('id');
      const parsedParams = AppendUploadRequestSchema.safeParse({
        ingestion_session_id: paramsId,
      });

      if (!parsedParams.success) {
        return c.json({ error: 'invalid_request', details: parsedParams.error.issues }, 400);
      }

      const ingestionSessionId = parsedParams.data.ingestion_session_id;
      const body = await c.req.parseBody();
      const file = body.file;

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'file field required (multipart)' }, 400);
      }

      const db = pmoDb();
      const rows = await db
        .select({
          id: ingestionSessions.id,
          status: ingestionSessions.status,
          planning_goal: ingestionSessions.planning_goal,
          planning_plan: ingestionSessions.planning_plan,
          workflow_execution_state: ingestionSessions.workflow_execution_state,
          profiling_documents: ingestionSessions.profiling_documents,
          source_file_key: ingestionSessions.source_file_key,
          source_file_name: ingestionSessions.source_file_name,
          source_file_size_bytes: ingestionSessions.source_file_size_bytes,
          mime_type: ingestionSessions.mime_type,
          created_at: ingestionSessions.created_at,
        })
        .from(ingestionSessions)
        .where(
          and(
            eq(ingestionSessions.id, ingestionSessionId),
            eq(ingestionSessions.tenant_id, session.tenant_id),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
      }

      const planningState = readPlanningState(row.status);
      if (planningState !== 'approved_plan') {
        return c.json(
          {
            error: 'invalid_state',
            message: 'Supplemental document upload is available only after plan approval.',
          },
          409,
        );
      }

      const filename = file.name || 'supplement.xlsx';
      const mimeType =
        file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const sizeBytes = Number.isFinite(file.size) ? file.size : null;
      const documentId = crypto.randomUUID();

      const s3Key = buildTenantKey({
        tenant_id: session.tenant_id,
        domain: 'pmo',
        file_id: `${ingestionSessionId}-${documentId}`,
        filename,
      });

      const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
      const region = process.env.S3_REGION ?? 'ap-southeast-1';
      const s3 = new S3Client({ region });
      const buffer = Buffer.from(await file.arrayBuffer());
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );

      const goal = row.planning_goal?.trim() || 'Profile workbook for PMO ingestion workflow.';
      const nowIso = new Date().toISOString();
      const existingExecutionState =
        readExecutionState(row.workflow_execution_state) ??
        createInitialExecutionState(row.planning_plan, nowIso);

      const persistedDocs = readDocuments(row.profiling_documents);
      let nextDocuments =
        existingExecutionState.documents.length > 0
          ? [...existingExecutionState.documents]
          : [...persistedDocs];

      if (nextDocuments.length === 0) {
        nextDocuments = [
          buildPrimaryDocumentRecord({
            source_file_key: row.source_file_key,
            source_file_name: row.source_file_name,
            source_file_size_bytes: row.source_file_size_bytes,
            mime_type: row.mime_type,
            uploaded_at: row.created_at,
          }),
        ];
      }

      const newDocumentBase: SessionDocumentProfileRecord = {
        document_id: documentId,
        source_file_key: s3Key,
        file_name: filename,
        file_size_bytes: sizeBytes,
        mime_type: mimeType,
        uploaded_at: nowIso,
        status: 'profiling',
      };

      const profiledNewDocument = await runSingleDocumentProfiling({
        goal,
        document: newDocumentBase,
      });

      nextDocuments.push(profiledNewDocument);

      const nextExecutionState = finalizeExecutionStateAfterProfiling({
        baseState: {
          ...existingExecutionState,
          started_at: existingExecutionState.started_at || nowIso,
        },
        documents: nextDocuments,
        nowIso,
      });

      await db
        .update(ingestionSessions)
        .set({
          workflow_execution_state: nextExecutionState,
          profiling_documents: nextExecutionState.documents,
          profiling_summary: nextExecutionState.profiling_summary,
          workflow_current_step: readCurrentStepName(nextExecutionState),
          workflow_step_status: nextExecutionState.current_step_status,
          workflow_started_at: asDateOrNull(nextExecutionState.started_at),
          workflow_updated_at: asDateOrNull(nextExecutionState.updated_at),
        })
        .where(
          and(
            eq(ingestionSessions.id, ingestionSessionId),
            eq(ingestionSessions.tenant_id, session.tenant_id),
          ),
        );

      return c.json({
        ingestion_session_id: ingestionSessionId,
        document: profiledNewDocument,
        execution_state: nextExecutionState,
        profiling_documents: nextExecutionState.documents,
        profiling_summary: nextExecutionState.profiling_summary,
        profiling_review: nextExecutionState.profiling_review,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[pmo/append-upload] error:', message, error);
      return c.json({ error: 'append_upload_failed', message }, 500);
    }
  });

  // POST /api/pmo/v1/profiling/review
  // Saves user review edits for workbook profiling without moving to next workflow step.
  app.post('/api/pmo/v1/profiling/review', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = ProfilingReviewUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id, sheet_overrides = [], waived_missing_areas = [] } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        status: ingestionSessions.status,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const executionState = readExecutionState(row.workflow_execution_state);
    if (!executionState) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Execution state is not initialized for profiling review.',
        },
        409,
      );
    }

    const nowIso = new Date().toISOString();
    const normalizedOverrides: ProfilingSheetReviewOverride[] = sheet_overrides.map((override) => ({
      document_id: override.document_id,
      sheet_name: override.sheet_name,
      final_area: override.final_area,
      mark_ignore: override.mark_ignore ?? false,
    }));

    const reviewState =
      readProfilingReviewState(executionState.profiling_review) ??
      createDefaultProfilingReviewState(nowIso);

    const mergedReviewState: ProfilingReviewState = {
      ...reviewState,
      status: 'needs_review',
      sheet_overrides: normalizedOverrides,
      waived_missing_areas: [...new Set(waived_missing_areas)] as KnownProfilingArea[],
      last_updated_at: nowIso,
      approved_at: undefined,
      approved_by: undefined,
    };

    const documentsWithOverrides = applyProfilingReviewOverrides(
      executionState.documents,
      mergedReviewState.sheet_overrides,
    );
    const summaryAfterOverrides = buildWorkbookProfilingSessionSummary(documentsWithOverrides);
    const summaryAfterWaive = applyWaivedMissingAreas(
      summaryAfterOverrides,
      mergedReviewState.waived_missing_areas,
    );

    const profilingStepNo = findProfilingStepNo(executionState.steps);
    const nextSteps = setProfilingStepStatus(executionState.steps, profilingStepNo, 'needs_review');
    const nextExecutionState: WorkflowExecutionState = {
      ...executionState,
      updated_at: nowIso,
      current_step_no: profilingStepNo,
      current_step_status: 'needs_review',
      steps: nextSteps,
      documents: documentsWithOverrides,
      profiling_summary: summaryAfterWaive,
      profiling_review: mergedReviewState,
    };

    await db
      .update(ingestionSessions)
      .set({
        workflow_execution_state: nextExecutionState,
        profiling_documents: nextExecutionState.documents,
        profiling_summary: nextExecutionState.profiling_summary,
        workflow_current_step: readCurrentStepName(nextExecutionState),
        workflow_step_status: nextExecutionState.current_step_status,
        workflow_updated_at: asDateOrNull(nextExecutionState.updated_at),
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    return c.json({
      ingestion_session_id,
      execution_state: nextExecutionState,
      profiling_documents: nextExecutionState.documents,
      profiling_summary: nextExecutionState.profiling_summary,
      profiling_review: nextExecutionState.profiling_review,
    });
  });

  // POST /api/pmo/v1/profiling/approve-continue
  // Confirms profiling review gate and unlocks the next workflow step.
  app.post('/api/pmo/v1/profiling/approve-continue', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = ProfilingApproveContinueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const executionState = readExecutionState(row.workflow_execution_state);
    if (!executionState) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Execution state is not initialized for profiling review.',
        },
        409,
      );
    }

    const profilingStepNo = findProfilingStepNo(executionState.steps);
    const nowIso = new Date().toISOString();
    const currentReviewState =
      readProfilingReviewState(executionState.profiling_review) ??
      createDefaultProfilingReviewState(nowIso);
    const isProfilingCurrent = executionState.current_step_no === profilingStepNo;
    const isPastProfilingStep = executionState.current_step_no > profilingStepNo;

    if (!isProfilingCurrent && !(isPastProfilingStep && currentReviewState.status !== 'approved')) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Profiling gate can be approved only when current step is Workbook Profiling.',
        },
        409,
      );
    }

    const sortedSteps = executionState.steps.slice().sort((a, b) => a.step_no - b.step_no);
    const nextStep = isProfilingCurrent
      ? sortedSteps.find((step) => step.step_no > profilingStepNo)
      : null;
    const nextStepNo = isProfilingCurrent
      ? (nextStep?.step_no ?? profilingStepNo)
      : executionState.current_step_no;

    const nextSteps = sortedSteps.map((step) => {
      if (step.step_no === profilingStepNo) {
        return {
          ...step,
          status: 'completed' as const,
        };
      }

      if (isProfilingCurrent && nextStep && step.step_no === nextStep.step_no) {
        return {
          ...step,
          status: 'in_progress' as const,
        };
      }

      return step;
    });

    const nextExecutionState: WorkflowExecutionState = {
      ...executionState,
      updated_at: nowIso,
      current_step_no: nextStepNo,
      current_step_status: isProfilingCurrent
        ? nextStep
          ? 'in_progress'
          : 'completed'
        : executionState.current_step_status,
      steps: nextSteps,
      profiling_review: {
        ...currentReviewState,
        status: 'approved',
        last_updated_at: nowIso,
        approved_at: nowIso,
        approved_by: session.user_id,
      },
    };

    await db
      .update(ingestionSessions)
      .set({
        workflow_execution_state: nextExecutionState,
        workflow_current_step: readCurrentStepName(nextExecutionState),
        workflow_step_status: nextExecutionState.current_step_status,
        workflow_updated_at: asDateOrNull(nextExecutionState.updated_at),
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    return c.json({
      ingestion_session_id,
      execution_state: nextExecutionState,
      profiling_documents: nextExecutionState.documents,
      profiling_summary: nextExecutionState.profiling_summary,
      profiling_review: nextExecutionState.profiling_review,
    });
  });

  return app;
}

export const normalizeProfilingSummaryForTests = normalizeProfilingSummary;
