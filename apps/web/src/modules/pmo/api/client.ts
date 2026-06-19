interface ApiErrorBody {
  error?: string;
  message?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}) as ApiErrorBody)) as ApiErrorBody;
    throw Object.assign(new Error(body.message ?? res.statusText), {
      status: res.status,
      code: body.error,
    });
  }
  return (await res.json()) as T;
}

export interface UploadWorkbookResponse {
  ingestion_session_id: string;
  s3_key: string;
  status: string;
  filename?: string;
  file_size_bytes?: number;
  message?: string;
}

interface UploadUrlResponse {
  ingestion_session_id: string;
  upload_url: string;
  s3_key: string;
  filename: string;
}

async function putWorkbookToS3(
  uploadUrl: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader(
      'Content-Type',
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`S3 upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('S3 upload failed (network error)'));
    xhr.send(file);
  });
}

export interface PmoPlan {
  intent_analysis?: {
    intent_mode:
      | 'review_only'
      | 'mapping_readiness'
      | 'stage_preview'
      | 'publish_intent'
      | 'publish_report_intent';
    confidence: 'low' | 'medium' | 'high';
    rationale: string;
    requires_confirmation: boolean;
    allowed_action_ids: Array<
      | 'workbook_profiling'
      | 'column_mapping'
      | 'normalize_to_staging'
      | 'database_change_summary'
      | 'publish_after_approval'
      | 'generate_report'
      | 'generic_review'
    >;
    confirmed_at?: string;
    confirmed_by?: string;
  };
  title: string;
  goal_summary: string;
  uploaded_file_summary: {
    file_name: string;
    file_size: string;
    uploaded_at: string;
    file_type: string;
  };
  scope_assumption: {
    likely_data_areas: Array<{
      data_area:
        | 'resource_allocation'
        | 'timesheet'
        | 'overbook_idle_config'
        | 'member_master'
        | 'project_master'
        | 'leave'
        | 'calendar_weeks'
        | 'kpi_norms'
        | 'unknown';
      reason: string;
      confidence: 'low' | 'medium' | 'high';
    }>;
    basis: string;
  };
  proposed_workflow: Array<{
    step_no: number;
    planner_step_id?: string;
    action_id?:
      | 'workbook_profiling'
      | 'column_mapping'
      | 'normalize_to_staging'
      | 'database_change_summary'
      | 'publish_after_approval'
      | 'generate_report'
      | 'generic_review';
    review_type?:
      | 'none'
      | 'profiling'
      | 'mapping'
      | 'normalization'
      | 'publish'
      | 'report'
      | 'generic';
    step_name: string;
    description: string;
    agent_responsibility: string;
    user_responsibility: string;
    requires_user_review: boolean;
  }>;
  compiled_workflow?: PmoPlan['proposed_workflow'];
  review_gates: Array<{
    gate_name: string;
    when_it_happens: string;
    what_user_reviews: string;
    available_actions: Array<'approve' | 'modify' | 'regenerate' | 'reject' | 'continue'>;
  }>;
  state_management_plan: {
    state_to_save: string[];
    resume_behavior: string;
  };
  risks_and_assumptions: Array<{
    type: 'risk' | 'assumption' | 'missing_information';
    description: string;
    impact: 'low' | 'medium' | 'high';
    how_it_will_be_handled_later: string;
  }>;
  not_yet_performed: string[];
  approval_policy: {
    can_continue_after_plan_approval: boolean;
    requires_mapping_review_before_normalization: boolean;
    requires_db_change_review_before_publish: boolean;
    will_publish_without_user_approval: boolean;
  };
  next_action: {
    label: string;
    description: string;
  };
}

export type PmoProfilingArea =
  | 'resource_allocation'
  | 'timesheet'
  | 'overbook_idle_config'
  | 'member_master'
  | 'project_master'
  | 'leave'
  | 'calendar_weeks'
  | 'kpi_norms'
  | 'unknown';

export interface PmoWorkbookSheetProfileSummary {
  sheet_name: string;
  row_count: number;
  column_count: number;
  header_row: number;
  candidate_business_area: PmoProfilingArea;
  confidence: number;
  likely_purpose: string;
  key_columns: string[];
  sample_value_patterns: string[];
  llm_interpretation?: {
    probable_area: PmoProfilingArea | 'ignore';
    confidence: 'low' | 'medium' | 'high';
    rationale: string;
    recommended_action: 'process' | 'review' | 'ignore';
  };
  final_decision?: {
    area: PmoProfilingArea;
    confidence: 'low' | 'medium' | 'high';
    source:
      | 'deterministic_only'
      | 'deterministic_and_llm_agree'
      | 'deterministic_conflict_with_llm'
      | 'llm_only'
      | 'user_override'
      | 'unresolved';
    requires_user_review: boolean;
  };
}

export interface PmoWorkbookProfilingDocumentResult {
  workbook_summary: {
    file_name: string;
    file_size_bytes: number | null;
    mime_type: string;
    uploaded_at: string;
    sheet_count: number;
    total_rows: number;
    total_columns: number;
    excluded_sheets: string[];
    parse_errors: string[];
  };
  sheets: PmoWorkbookSheetProfileSummary[];
  detected_data_areas: PmoProfilingArea[];
  recommendations: {
    missing_recommended_data_areas: PmoProfilingArea[];
    likely_ignorable_sheets: string[];
    suggested_next_step: string;
  };
  generated_at: string;
}

export interface PmoSessionDocumentProfileRecord {
  document_id: string;
  source_file_key: string;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string;
  uploaded_at: string;
  status: 'uploaded' | 'profiling' | 'profiled' | 'profile_failed';
  profile_result?: PmoWorkbookProfilingDocumentResult;
  error_message?: string;
}

export type PmoWorkflowExecutionStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'needs_review'
  | 'failed'
  | 'cancelled';

export interface PmoProfilingSheetReviewOverride {
  document_id: string;
  sheet_name: string;
  final_area: PmoProfilingArea;
  mark_ignore: boolean;
}

export interface PmoProfilingReviewState {
  status: 'needs_review' | 'approved';
  sheet_overrides: PmoProfilingSheetReviewOverride[];
  waived_missing_areas: Array<Exclude<PmoProfilingArea, 'unknown'>>;
  last_updated_at: string;
  approved_at?: string;
  approved_by?: string;
}

export interface PmoWorkflowExecutionStep {
  step_no: number;
  planner_step_id?: string;
  action_id?: string;
  review_type?: string;
  step_name: string;
  status: PmoWorkflowExecutionStepStatus;
  output_summary?: Record<string, unknown>;
}

export interface PmoWorkbookProfilingSessionSummary {
  generated_at: string;
  document_count: number;
  profiled_document_count: number;
  total_sheet_count: number;
  total_row_count: number;
  detected_data_areas: PmoProfilingArea[];
  missing_recommended_data_areas: PmoProfilingArea[];
  missing_recommended_data_areas_details: Array<{
    data_area: Exclude<PmoProfilingArea, 'unknown'>;
    source: 'goal_rule' | 'llm_interpretation' | 'combined';
    reason: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
  likely_ignorable_sheets: string[];
  suggested_next_step: string;
}

export interface PmoWorkflowExecutionState {
  state_version: 1;
  started_at: string;
  updated_at: string;
  current_step_no: number;
  current_step_status: 'in_progress' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
  steps: PmoWorkflowExecutionStep[];
  documents: PmoSessionDocumentProfileRecord[];
  profiling_summary: PmoWorkbookProfilingSessionSummary | null;
  profiling_review: PmoProfilingReviewState | null;
  report_request?: unknown;
  report_result?: unknown;
}

export interface PmoPlanningSession {
  ingestion_session_id: string;
  workbook_name: string;
  workbook_size_bytes: number;
  workbook_size: string;
  file_type: string;
  uploaded_at: string;
  operator: string;
  planning_state: 'uploaded' | 'generating_plan' | 'plan_review' | 'approved_plan';
  status_label: string;
  active_gate: string;
  progress_text: string;
  progress_pct: number;
  goal: string;
  plan: PmoPlan | null;
  plan_version: number;
  feedback_history: string[];
  execution_state: PmoWorkflowExecutionState | null;
  profiling_documents: PmoSessionDocumentProfileRecord[];
  profiling_summary: PmoWorkbookProfilingSessionSummary | null;
  profiling_review: PmoProfilingReviewState | null;
  workflow_current_step: string | null;
  workflow_step_status:
    | 'in_progress'
    | 'needs_review'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | null;
  workflow_started_at: string | null;
  workflow_updated_at: string | null;
  plan_generated_at: string | null;
  plan_approved_at: string | null;
}

export interface ListPlanningSessionsResponse {
  items: PmoPlanningSession[];
}

export interface GeneratePlanInput {
  ingestion_session_id: string;
  goal: string;
  previous_plan?: PmoPlan | null;
  plan_feedback?: string;
}

export interface GeneratePlanResponse {
  ingestion_session_id: string;
  planning_state: 'plan_review';
  plan: PmoPlan;
  plan_version: number;
  feedback_history: string[];
}

export interface ApprovePlanResponse {
  ingestion_session_id: string;
  planning_state: 'approved_plan';
  approved_at: string;
  execution_state: PmoWorkflowExecutionState;
  profiling_documents: PmoSessionDocumentProfileRecord[];
  profiling_summary: PmoWorkbookProfilingSessionSummary | null;
  profiling_review: PmoProfilingReviewState | null;
}

export interface ConfirmPlanIntentResponse {
  ingestion_session_id: string;
  planning_state: 'plan_review';
  plan: PmoPlan;
  confirmed_at: string;
}

export interface AppendSessionDocumentResponse {
  ingestion_session_id: string;
  document: PmoSessionDocumentProfileRecord;
  execution_state: PmoWorkflowExecutionState;
  profiling_documents: PmoSessionDocumentProfileRecord[];
  profiling_summary: PmoWorkbookProfilingSessionSummary | null;
  profiling_review: PmoProfilingReviewState | null;
}

export interface UpdateProfilingReviewInput {
  ingestion_session_id: string;
  sheet_overrides?: PmoProfilingSheetReviewOverride[];
  waived_missing_areas?: Array<Exclude<PmoProfilingArea, 'unknown'>>;
}

export interface UpdateProfilingReviewResponse {
  ingestion_session_id: string;
  execution_state: PmoWorkflowExecutionState;
  profiling_documents: PmoSessionDocumentProfileRecord[];
  profiling_summary: PmoWorkbookProfilingSessionSummary | null;
  profiling_review: PmoProfilingReviewState | null;
}

export interface ApproveProfilingContinueResponse {
  ingestion_session_id: string;
  execution_state: PmoWorkflowExecutionState;
  profiling_documents: PmoSessionDocumentProfileRecord[];
  profiling_summary: PmoWorkbookProfilingSessionSummary | null;
  profiling_review: PmoProfilingReviewState | null;
}

export interface CancelWorkflowResponse {
  ingestion_session_id: string;
  cancelled_at: string;
  execution_state: PmoWorkflowExecutionState;
  workflow_current_step: string | null;
  workflow_step_status: 'in_progress' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
}

export interface StartIngestWorkflowInput {
  ingestionSessionId: string;
  fileKey: string;
  reportingPeriodKey?: string;
}

export interface StartIngestWorkflowResponse {
  runId: string;
}

export interface UploadWorkbookOptions {
  reportingPeriodKey?: string;
  chatThreadId?: string;
  onProgress?: (fraction: number) => void;
}

export const pmoApi = {
  async uploadWorkbook(
    file: File,
    reportingPeriodKeyOrOptions?: string | UploadWorkbookOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<UploadWorkbookResponse> {
    const options: UploadWorkbookOptions =
      typeof reportingPeriodKeyOrOptions === 'string'
        ? { reportingPeriodKey: reportingPeriodKeyOrOptions, onProgress }
        : {
            ...reportingPeriodKeyOrOptions,
            onProgress: onProgress ?? reportingPeriodKeyOrOptions?.onProgress,
          };

    const mimeType =
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const urlRes = await fetch('/api/pmo/v1/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        filename: file.name,
        file_size_bytes: file.size,
        mime_type: mimeType,
        ...(options.reportingPeriodKey ? { reporting_period_key: options.reportingPeriodKey } : {}),
        ...(options.chatThreadId ? { chat_thread_id: options.chatThreadId } : {}),
      }),
    });
    const urlBody = await jsonOrThrow<UploadUrlResponse>(urlRes);

    await putWorkbookToS3(urlBody.upload_url, file, options.onProgress);

    return {
      ingestion_session_id: urlBody.ingestion_session_id,
      s3_key: urlBody.s3_key,
      status: 'uploaded',
      filename: urlBody.filename,
      file_size_bytes: file.size,
      message: 'Workbook uploaded to PMO ingestion storage.',
    };
  },

  async startIngestWorkflow(input: StartIngestWorkflowInput): Promise<StartIngestWorkflowResponse> {
    const workflowId = 'pmo.ingestData.v2';

    const res = await fetch(`/api/agent/v1/workflows/runs/${workflowId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    return jsonOrThrow<StartIngestWorkflowResponse>(res);
  },

  async listPlanningSessions(): Promise<ListPlanningSessionsResponse> {
    const res = await fetch('/api/pmo/v1/ingestion-sessions', {
      method: 'GET',
      credentials: 'include',
    });
    return jsonOrThrow<ListPlanningSessionsResponse>(res);
  },

  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanResponse> {
    const res = await fetch('/api/pmo/v1/plan/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    return jsonOrThrow<GeneratePlanResponse>(res);
  },

  async approvePlan(ingestionSessionId: string): Promise<ApprovePlanResponse> {
    const res = await fetch('/api/pmo/v1/plan/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingestion_session_id: ingestionSessionId }),
      credentials: 'include',
    });
    return jsonOrThrow<ApprovePlanResponse>(res);
  },

  async confirmPlanIntent(ingestionSessionId: string): Promise<ConfirmPlanIntentResponse> {
    const res = await fetch('/api/pmo/v1/plan/confirm-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingestion_session_id: ingestionSessionId }),
      credentials: 'include',
    });
    return jsonOrThrow<ConfirmPlanIntentResponse>(res);
  },

  async appendSessionDocument(
    ingestionSessionId: string,
    file: File,
  ): Promise<AppendSessionDocumentResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(
      `/api/pmo/v1/ingestion-sessions/${ingestionSessionId}/documents/upload`,
      {
        method: 'POST',
        body: formData,
        credentials: 'include',
      },
    );
    return jsonOrThrow<AppendSessionDocumentResponse>(res);
  },

  async updateProfilingReview(
    input: UpdateProfilingReviewInput,
  ): Promise<UpdateProfilingReviewResponse> {
    const res = await fetch('/api/pmo/v1/profiling/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    return jsonOrThrow<UpdateProfilingReviewResponse>(res);
  },

  async approveProfilingContinue(
    ingestionSessionId: string,
  ): Promise<ApproveProfilingContinueResponse> {
    const res = await fetch('/api/pmo/v1/profiling/approve-continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingestion_session_id: ingestionSessionId }),
      credentials: 'include',
    });
    return jsonOrThrow<ApproveProfilingContinueResponse>(res);
  },

  async cancelWorkflow(ingestionSessionId: string): Promise<CancelWorkflowResponse> {
    const res = await fetch('/api/pmo/v1/workflow/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingestion_session_id: ingestionSessionId }),
      credentials: 'include',
    });
    return jsonOrThrow<CancelWorkflowResponse>(res);
  },
};
