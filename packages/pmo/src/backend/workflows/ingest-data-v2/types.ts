import type { ApprovalCard } from '@seta/agent-sdk';
import type { PmoPlanActionId, PmoReviewType } from '../../planning/step-metadata.ts';
import type {
  ProfilingReviewState,
  SessionDocumentProfileRecord,
  WorkflowExecutionStepStatus,
} from '../../profiling/workbook-profiling.ts';

export type DynamicRuntimeSessionStatus =
  | 'approved_plan'
  | 'profiling'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'normalizing'
  | 'awaiting_normalization_review'
  | 'staging_normalized'
  | 'awaiting_publish_review'
  | 'published'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export type DynamicCurrentStepStatus =
  | 'in_progress'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PlannerExecutionStepV2 {
  step_no: number;
  planner_step_id: string;
  action_id: PmoPlanActionId;
  review_type: PmoReviewType;
  step_name: string;
  status: WorkflowExecutionStepStatus;
  output_summary?: Record<string, unknown>;
  review_status?: 'not_needed' | 'pending' | 'approved' | 'rejected' | 'modified';
}

export interface PlannerExecutionStateV2 {
  state_version: 2;
  started_at: string;
  updated_at: string;
  current_step_no: number;
  current_planner_step_id: string;
  current_step_status: DynamicCurrentStepStatus;
  steps: PlannerExecutionStepV2[];
  documents: SessionDocumentProfileRecord[];
  profiling_summary: Record<string, unknown> | null;
  profiling_review: ProfilingReviewState | null;
}

export interface DynamicIngestRuntimeContext {
  detected_schema?: {
    tableMappings: unknown[];
    validationStatus: 'confirmed' | 'needs_review' | 'blocked';
    workbookConfidence: number;
  };
  confirmed_mapping?: {
    confirmedMappings: unknown[];
    mappingReviewRows: Array<{ k: string; v: string }>;
  };
  staging_result?: {
    changeSummary: unknown[];
    blockingIssues: unknown[];
    mappingReviewRows: Array<{ k: string; v: string }>;
    hasBlockingIssues: boolean;
    hasUpdates: boolean;
    requiresReview: boolean;
  };
}

export interface PmoDynamicHandlerInput {
  ingestionSessionId: string;
  fileKey: string;
  tenantId: string;
  userId: string;
  runId: string;
  requestContext: { get: (key: string) => unknown };
  resumeData: Record<string, unknown> | undefined;
  step: PlannerExecutionStepV2;
  planningPlan: unknown;
  runtimeContext: DynamicIngestRuntimeContext;
}

export type PmoDynamicHandlerResult =
  | {
      kind: 'suspend';
      card: ApprovalCard;
      sessionStatus: DynamicRuntimeSessionStatus;
      runtimeContextPatch?: Partial<DynamicIngestRuntimeContext>;
      outputSummary?: Record<string, unknown>;
    }
  | {
      kind: 'completed';
      sessionStatus?: DynamicRuntimeSessionStatus;
      runtimeContextPatch?: Partial<DynamicIngestRuntimeContext>;
      outputSummary?: Record<string, unknown>;
      sessionPatch?: Record<string, unknown>;
      terminalOutput?: {
        ingestionSessionId: string;
        status: 'published' | 'rejected' | 'completed';
        rowsWritten?: Record<string, number>;
        rowsUpdated?: Record<string, number>;
        rowsSkipped?: Record<string, number>;
      };
    }
  | {
      kind: 'rejected';
      sessionStatus: DynamicRuntimeSessionStatus;
      outputSummary?: Record<string, unknown>;
      sessionPatch?: Record<string, unknown>;
      terminalOutput?: {
        ingestionSessionId: string;
        status: 'rejected';
        rowsWritten?: Record<string, number>;
        rowsUpdated?: Record<string, number>;
        rowsSkipped?: Record<string, number>;
      };
    };

export interface PmoDynamicStepHandler {
  actionId: PmoPlanActionId;
  execute: (input: PmoDynamicHandlerInput) => Promise<PmoDynamicHandlerResult>;
}
