import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../../db/client.ts';
import { ingestionSessions } from '../../db/schema.ts';
import { type GeneratePmoPlanInput, generatePmoWorkflowPlan } from '../generate-plan.ts';
import { type ClassifiedPmoIntent, classifyPmoPlanningIntent } from '../intent-classifier.ts';
import { IntentAnalysisSchema, type PmoWorkflowPlan } from '../plan-schema.ts';
import type { PlanGenerationJobPayload } from './enqueue-plan-generation.ts';

interface PlanningSessionSnapshot {
  sourceFileKey: string | null;
  sourceFileName: string | null;
  sourceFileSizeBytes: number | null;
  mimeType: string | null;
  createdAt: Date;
  planningGoal: string | null;
  planningIntent: unknown;
  planVersion: number;
  feedbackHistory: unknown;
}

export interface PlanGenerationJobDeps {
  loadSession: (tenantId: string, sessionId: string) => Promise<PlanningSessionSnapshot>;
  classifyIntent: typeof classifyPmoPlanningIntent;
  generatePlan: (input: GeneratePmoPlanInput) => Promise<PmoWorkflowPlan>;
  saveIntentReview: (input: {
    tenantId: string;
    sessionId: string;
    goal: string;
    intent: ClassifiedPmoIntent;
  }) => Promise<void>;
  savePlanReview: (input: {
    tenantId: string;
    sessionId: string;
    goal: string;
    intent: ClassifiedPmoIntent;
    plan: PmoWorkflowPlan;
    planVersion: number;
    feedbackHistory: string[];
  }) => Promise<void>;
  markFailed: (input: { tenantId: string; sessionId: string; message: string }) => Promise<void>;
}

const DEFAULT_DEPS: PlanGenerationJobDeps = {
  loadSession,
  classifyIntent: classifyPmoPlanningIntent,
  generatePlan: generatePmoWorkflowPlan,
  saveIntentReview,
  savePlanReview,
  markFailed,
};

export async function runPlanGenerationJob(
  rawPayload: unknown,
  deps: PlanGenerationJobDeps = DEFAULT_DEPS,
): Promise<void> {
  const payload = parsePayload(rawPayload);
  try {
    const session = await deps.loadSession(payload.tenantId, payload.sessionId);
    const storedIntent =
      session.planningGoal === payload.goal && !payload.planFeedback
        ? IntentAnalysisSchema.safeParse(session.planningIntent)
        : null;
    const intent =
      storedIntent?.success && !storedIntent.data.requires_confirmation
        ? storedIntent.data
        : await deps.classifyIntent(payload.goal, {
            hasUploadedFile: Boolean(session.sourceFileKey),
            ...(payload.planFeedback ? { planFeedback: payload.planFeedback } : {}),
          });

    if (intent.requires_confirmation) {
      await deps.saveIntentReview({
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        goal: payload.goal,
        intent,
      });
      return;
    }

    const plan = await deps.generatePlan({
      goal: payload.goal,
      intent,
      uploaded_file:
        intent.dataSourceMode === 'uploaded_file' &&
        session.sourceFileKey &&
        session.sourceFileName &&
        session.mimeType
          ? {
              file_name: session.sourceFileName,
              file_size: formatFileSize(session.sourceFileSizeBytes),
              uploaded_at: session.createdAt.toISOString(),
              file_type: session.mimeType,
            }
          : null,
      workflow_capabilities: {
        can_parse_excel_workbook: true,
        can_detect_sheet_roles: true,
        can_propose_column_mappings: true,
        can_normalize_to_staging: true,
        can_compare_with_existing_database: true,
        can_generate_db_change_summary: true,
        can_publish_after_user_approval: true,
      },
      previous_plan: payload.previousPlan ?? null,
      ...(payload.planFeedback ? { plan_feedback: payload.planFeedback } : {}),
    });
    const feedbackHistory = Array.isArray(session.feedbackHistory)
      ? session.feedbackHistory.filter((value): value is string => typeof value === 'string')
      : [];

    await deps.savePlanReview({
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      goal: payload.goal,
      intent,
      plan,
      planVersion: session.planVersion + 1,
      feedbackHistory: payload.planFeedback
        ? [...feedbackHistory, payload.planFeedback]
        : feedbackHistory,
    });
  } catch (error) {
    const message = sanitizeFailureMessage(error);
    await deps.markFailed({
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      message,
    });
    throw error;
  }
}

async function loadSession(tenantId: string, sessionId: string): Promise<PlanningSessionSnapshot> {
  const rows = await pmoDb()
    .select({
      sourceFileKey: ingestionSessions.source_file_key,
      sourceFileName: ingestionSessions.source_file_name,
      sourceFileSizeBytes: ingestionSessions.source_file_size_bytes,
      mimeType: ingestionSessions.mime_type,
      createdAt: ingestionSessions.created_at,
      planningGoal: ingestionSessions.planning_goal,
      planningIntent: ingestionSessions.planning_intent,
      planVersion: ingestionSessions.planning_plan_version,
      feedbackHistory: ingestionSessions.planning_feedback_history,
    })
    .from(ingestionSessions)
    .where(and(eq(ingestionSessions.id, sessionId), eq(ingestionSessions.tenant_id, tenantId)))
    .limit(1);
  if (!rows[0]) throw new Error('ingestion_session_not_found');
  return rows[0];
}

async function saveIntentReview(input: {
  tenantId: string;
  sessionId: string;
  goal: string;
  intent: ClassifiedPmoIntent;
}): Promise<void> {
  await pmoDb()
    .update(ingestionSessions)
    .set({
      status: 'intent_review',
      planning_goal: input.goal,
      planning_intent: input.intent,
      planning_generation_error: null,
    })
    .where(
      and(
        eq(ingestionSessions.id, input.sessionId),
        eq(ingestionSessions.tenant_id, input.tenantId),
      ),
    );
}

async function savePlanReview(input: {
  tenantId: string;
  sessionId: string;
  goal: string;
  intent: ClassifiedPmoIntent;
  plan: PmoWorkflowPlan;
  planVersion: number;
  feedbackHistory: string[];
}): Promise<void> {
  await pmoDb()
    .update(ingestionSessions)
    .set({
      status: 'plan_review',
      planning_goal: input.goal,
      planning_intent: input.intent,
      planning_plan: input.plan,
      planning_plan_version: input.planVersion,
      planning_feedback_history: input.feedbackHistory,
      planning_last_generated_at: new Date(),
      planning_generation_error: null,
    })
    .where(
      and(
        eq(ingestionSessions.id, input.sessionId),
        eq(ingestionSessions.tenant_id, input.tenantId),
      ),
    );
}

async function markFailed(input: {
  tenantId: string;
  sessionId: string;
  message: string;
}): Promise<void> {
  await pmoDb()
    .update(ingestionSessions)
    .set({ status: 'plan_generation_failed', planning_generation_error: input.message })
    .where(
      and(
        eq(ingestionSessions.id, input.sessionId),
        eq(ingestionSessions.tenant_id, input.tenantId),
      ),
    );
}

function parsePayload(raw: unknown): PlanGenerationJobPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid_pmo_plan_generation_payload');
  }
  const payload = raw as Partial<PlanGenerationJobPayload>;
  if (!payload.tenantId || !payload.userId || !payload.sessionId || !payload.goal) {
    throw new Error('invalid_pmo_plan_generation_payload');
  }
  return {
    tenantId: payload.tenantId,
    userId: payload.userId,
    sessionId: payload.sessionId,
    goal: payload.goal,
    ...(payload.planFeedback ? { planFeedback: payload.planFeedback } : {}),
    ...(payload.previousPlan !== undefined ? { previousPlan: payload.previousPlan } : {}),
  };
}

function formatFileSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 500) || 'Plan generation failed';
}
