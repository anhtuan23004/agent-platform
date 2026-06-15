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

export interface PmoPlan {
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
        | 'member_master'
        | 'project_master'
        | 'leave'
        | 'holiday'
        | 'training'
        | 'unknown';
      reason: string;
      confidence: 'low' | 'medium' | 'high';
    }>;
    basis: string;
  };
  proposed_workflow: Array<{
    step_no: number;
    step_name: string;
    description: string;
    agent_responsibility: string;
    user_responsibility: string;
    requires_user_review: boolean;
  }>;
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
}

export interface StartIngestWorkflowInput {
  ingestionSessionId: string;
  fileKey: string;
  reportingPeriodKey?: string;
}

export interface StartIngestWorkflowResponse {
  runId: string;
}

export const pmoApi = {
  async uploadWorkbook(file: File, reportingPeriodKey?: string): Promise<UploadWorkbookResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (reportingPeriodKey) {
      formData.append('reporting_period_key', reportingPeriodKey);
    }

    const res = await fetch('/api/pmo/v1/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    return jsonOrThrow<UploadWorkbookResponse>(res);
  },

  async startIngestWorkflow(input: StartIngestWorkflowInput): Promise<StartIngestWorkflowResponse> {
    const res = await fetch('/api/agent/v1/workflows/runs/pmo.ingestData/start', {
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
};
