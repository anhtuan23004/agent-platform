import type { ApprovalCard } from '@seta/agent-sdk';
import type { ReviewCheckpointState } from '@seta/ingestion';
import type { PmoPlanActionId, PmoReviewType } from '../../planning/step-metadata.ts';
import type {
  ProfilingReviewState,
  SessionDocumentProfileRecord,
  WorkbookProfilingSessionSummary,
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
  | 'reviewed'
  | 'awaiting_report_range'
  | 'generating_report'
  | 'report_generated'
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

export interface PlannerStepViewState {
  action_id: PmoPlanActionId;
  review_type: PmoReviewType;
  planner_step_id: string;
  step_name: string;
  status: DynamicCurrentStepStatus;
  review_status?: PlannerExecutionStepV2['review_status'];
  approval_payload?: unknown;
  runtime_payload?: unknown;
  output_summary?: Record<string, unknown>;
  updated_at: string;
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
  profiling_summary: WorkbookProfilingSessionSummary | Record<string, unknown> | null;
  profiling_review: ProfilingReviewState | null;
  report_request?: DynamicIngestRuntimeContext['report_request'];
  report_result?: DynamicIngestRuntimeContext['report_result'];
  step_views?: Record<string, PlannerStepViewState>;
}

export interface DynamicIngestRuntimeContext {
  /** Domain identifier for this ingestion session (e.g. 'pmo', 'hr'). Defaults to 'pmo'. */
  domainId?: string;
  /** Domain config version used for this session, for reproducibility. */
  domainConfigVersion?: string;
  detected_schema?: {
    tableMappings: unknown[];
    validationStatus: 'confirmed' | 'needs_review' | 'blocked';
    workbookConfidence: number;
  } & ReviewCheckpointState;
  confirmed_mapping?: ReviewCheckpointState & {
    confirmedMappings?: unknown[];
    mappingReviewRows?: Array<{ k: string; v: string }>;
  };
  staging_result?: {
    changeSummary: unknown[];
    blockingIssues: unknown[];
    mappingReviewRows: Array<{ k: string; v: string }>;
    hasBlockingIssues: boolean;
    hasUpdates: boolean;
    requiresReview: boolean;
  } & ReviewCheckpointState;
  report_request?: {
    reportTypes: Array<'idle_members' | 'overbook_members' | 'forward_allocation'>;
    workloadDateRange?: {
      from: string;
      to: string;
      source: 'goal_explicit' | 'user_confirmed' | 'sheet_derived' | 'sheet_suggested_pending';
    };
    forwardAllocationDateRange?: {
      from: string;
      to: string;
      source: 'goal_explicit' | 'user_confirmed' | 'sheet_derived' | 'sheet_suggested_pending';
    };
    suggestedWorkloadDateRange?: {
      from: string;
      to: string;
      source: 'sheet' | 'database';
    };
    suggestedForwardAllocationDateRange?: {
      from: string;
      to: string;
      source: 'database';
    };
  };
  report_result?: {
    reportRunIds?: string[];
    workload?: {
      reportRunId: string;
      dateRange: { from: string; to: string };
    };
    forwardAllocation?: {
      reportRunId: string;
      dateRange: { from: string; to: string };
    };
  };
  profiling?: {
    documents: SessionDocumentProfileRecord[];
    summary: WorkbookProfilingSessionSummary;
    review: ProfilingReviewState;
  };
}

export interface PmoDynamicHandlerInput {
  ingestionSessionId: string;
  fileKey?: string;
  fileName?: string;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  uploadedAt?: string | null;
  tenantId: string;
  userId: string;
  runId: string;
  planningGoal?: string | null;
  reportingPeriodStart?: Date | null;
  reportingPeriodEnd?: Date | null;
  requestContext: { get: (key: string) => unknown };
  resumeData: Record<string, unknown> | undefined;
  step: PlannerExecutionStepV2;
  planningPlan: unknown;
  reportSource?: 'canonical_db' | 'staging_preview' | 'published_batch';
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
        reportRunId?: string | null;
        reportRunIds?: string[];
        report?: unknown;
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
        reportRunId?: string | null;
        reportRunIds?: string[];
        report?: unknown;
      };
    };

export interface PmoDynamicStepHandler {
  actionId: PmoPlanActionId;
  execute: (input: PmoDynamicHandlerInput) => Promise<PmoDynamicHandlerResult>;
}
