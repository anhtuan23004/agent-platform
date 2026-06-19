import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import { loadPmoPlannerCatalog, type PmoActionMode } from '../planning/catalog.ts';
import { compilePmoWorkflowSteps } from '../planning/compiler.ts';
import type { PmoWorkflowPlan } from '../planning/plan-schema.ts';

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildDeterministicChatIngestPlan(params: {
  actionMode: Extract<PmoActionMode, 'publish' | 'publish_then_report'>;
  fileName: string;
  fileSizeBytes: number | null;
  mimeType: string;
  uploadedAt: Date;
  goal: string;
}): PmoWorkflowPlan {
  const catalog = loadPmoPlannerCatalog();
  const compiled = compilePmoWorkflowSteps({
    dataSourceMode: 'uploaded_file',
    actionMode: params.actionMode,
    candidateSteps: [],
    catalog,
  });

  return {
    title: 'PMO chat ingest',
    goal_summary: params.goal,
    uploaded_file_summary: {
      file_name: params.fileName,
      file_size: formatFileSize(params.fileSizeBytes),
      uploaded_at: params.uploadedAt.toISOString(),
      file_type: params.mimeType,
    },
    scope_assumption: {
      likely_data_areas: [
        {
          data_area: 'resource_allocation',
          reason: 'Workbook uploaded from PMO Agent chat for ingestion.',
          confidence: 'medium',
        },
      ],
      basis: 'User uploaded a workbook in PMO Agent chat and requested ingestion.',
    },
    proposed_workflow: compiled.compiled_workflow,
    compiled_workflow: compiled.compiled_workflow,
    intent_analysis: {
      dataSourceMode: 'uploaded_file',
      actionMode: params.actionMode,
      writePolicy: 'requires_approval',
      confidence: 'high',
      rationale: 'Deterministic chat-ingest plan seeded for PMO Agent workflow kickoff.',
      requires_confirmation: false,
      allowed_action_ids: compiled.compiled_workflow.map((step) => step.action_id),
    },
    review_gates: [
      {
        gate_name: 'Column mapping review',
        when_it_happens: 'After workbook profiling when mappings need confirmation.',
        what_user_reviews: 'Proposed column mappings before normalization.',
        available_actions: ['approve', 'modify', 'reject'],
      },
      {
        gate_name: 'Publish review',
        when_it_happens: 'After staging when database changes are ready.',
        what_user_reviews: 'Summary of records to create or update before publish.',
        available_actions: ['approve', 'reject'],
      },
    ],
    state_management_plan: {
      state_to_save: ['intent_analysis', 'compiled_workflow', 'planner_diagnostics'],
      resume_behavior: 'Resume from the suspended planner step after user approval.',
    },
    risks_and_assumptions: [
      {
        type: 'assumption',
        description: 'Uploaded workbook matches expected PMO sheet layout.',
        impact: 'medium',
        how_it_will_be_handled_later: 'Workbook profiling and mapping gates surface mismatches.',
      },
    ],
    not_yet_performed: [
      'Workbook parsing',
      'Column mapping',
      'Normalization to staging',
      'Database change comparison',
      'Publish',
    ],
    approval_policy: {
      can_continue_after_plan_approval: true,
      requires_mapping_review_before_normalization: true,
      requires_db_change_review_before_publish: true,
      will_publish_without_user_approval: false,
    },
    next_action: {
      label: 'Start ingest',
      description: 'Run the ingest workflow; review gates will appear as approval cards in chat.',
    },
  };
}

export interface PrepareChatIngestSessionInput {
  ingestionSessionId: string;
  tenantId: string;
  /** PMO Agent chat thread; session must be uploaded in this thread. */
  chatThreadId?: string;
  generateReport?: boolean;
  dateFrom?: string;
  dateTo?: string;
  goal?: string;
}

export interface PrepareChatIngestSessionResult {
  fileKey: string;
  planningGoal: string;
}

/**
 * Ensures an ingestion session has a deterministic approved plan before the chat
 * agent starts `pmo.ingestData.v2`. Skips LLM planning — compiles steps from the
 * planner catalog for publish or publish+report intents.
 */
export async function prepareChatIngestSession(
  input: PrepareChatIngestSessionInput,
): Promise<PrepareChatIngestSessionResult> {
  const db = pmoDb();
  const rows = await db
    .select({
      id: ingestionSessions.id,
      status: ingestionSessions.status,
      source_file_key: ingestionSessions.source_file_key,
      source_file_name: ingestionSessions.source_file_name,
      source_file_size_bytes: ingestionSessions.source_file_size_bytes,
      mime_type: ingestionSessions.mime_type,
      created_at: ingestionSessions.created_at,
      planning_plan: ingestionSessions.planning_plan,
      planning_goal: ingestionSessions.planning_goal,
      chat_thread_id: ingestionSessions.chat_thread_id,
    })
    .from(ingestionSessions)
    .where(
      and(
        eq(ingestionSessions.id, input.ingestionSessionId),
        eq(ingestionSessions.tenant_id, input.tenantId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error('ingestion_session_not_found');
  }

  if (input.chatThreadId) {
    if (!row.chat_thread_id || row.chat_thread_id !== input.chatThreadId) {
      throw new Error('ingestion_session_not_in_chat_thread');
    }
  }

  if (!row.source_file_key || !row.source_file_name || !row.mime_type) {
    throw new Error('ingestion_session_source_file_missing');
  }

  const actionMode = input.generateReport ? 'publish_then_report' : 'publish';

  const dateClause =
    input.dateFrom && input.dateTo
      ? ` Report date range ${input.dateFrom} to ${input.dateTo}.`
      : '';
  const planningGoal =
    input.goal?.trim() ||
    `Ingest and publish the uploaded PMO workbook from chat.${dateClause}`.trim();

  const existingPlan = row.planning_plan;
  const hasCompiledPlan =
    existingPlan &&
    typeof existingPlan === 'object' &&
    !Array.isArray(existingPlan) &&
    Array.isArray((existingPlan as { compiled_workflow?: unknown }).compiled_workflow) &&
    ((existingPlan as { compiled_workflow: unknown[] }).compiled_workflow.length ?? 0) > 0;

  const plan =
    hasCompiledPlan && row.status === 'approved_plan'
      ? (existingPlan as PmoWorkflowPlan)
      : buildDeterministicChatIngestPlan({
          actionMode,
          fileName: row.source_file_name,
          fileSizeBytes: row.source_file_size_bytes,
          mimeType: row.mime_type,
          uploadedAt: row.created_at,
          goal: planningGoal,
        });

  const reportingPeriodStart =
    input.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom)
      ? new Date(`${input.dateFrom}T00:00:00.000Z`)
      : null;
  const reportingPeriodEnd =
    input.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo)
      ? new Date(`${input.dateTo}T00:00:00.000Z`)
      : null;

  await db
    .update(ingestionSessions)
    .set({
      status: 'approved_plan',
      planning_goal: planningGoal,
      planning_plan: plan,
      planning_approved_at: new Date(),
      ...(reportingPeriodStart ? { reporting_period_start: reportingPeriodStart } : {}),
      ...(reportingPeriodEnd ? { reporting_period_end: reportingPeriodEnd } : {}),
    })
    .where(
      and(
        eq(ingestionSessions.id, input.ingestionSessionId),
        eq(ingestionSessions.tenant_id, input.tenantId),
      ),
    );

  return { fileKey: row.source_file_key, planningGoal };
}
