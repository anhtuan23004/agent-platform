import { Button, Dropzone, Input, Label, PageChrome, Textarea, toast } from '@seta/shared-ui';
import { CheckCircle2, Circle, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type GeneratePlanInput,
  type PmoPlan,
  type PmoPlanningSession,
  type PmoProfilingArea,
  type PmoProfilingSheetReviewOverride,
  type PmoSessionDocumentProfileRecord,
  type PmoWorkflowExecutionStepStatus,
  pmoApi,
} from '../api/client';

const ACCEPT = '.xlsx,.xlsm';
const MAX_BYTES = 50 * 1024 * 1024;
const PROFILING_AREAS: PmoProfilingArea[] = [
  'resource_allocation',
  'timesheet',
  'member_master',
  'project_master',
  'leave',
  'holiday',
  'training',
  'unknown',
];

type TimelineState = 'done' | 'current' | 'pending';

function formatLocalDate(isoText: string | null | undefined): string {
  if (!isoText) {
    return '-';
  }

  const parsed = new Date(isoText);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }

  return parsed.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function profilingSheetKey(documentId: string, sheetName: string): string {
  return `${documentId}::${sheetName}`;
}

function toneForState(state: TimelineState): { marker: string; text: string } {
  if (state === 'done') {
    return {
      marker: 'bg-success text-white border-success',
      text: 'text-success-ink',
    };
  }

  if (state === 'current') {
    return {
      marker: 'bg-warning text-white border-warning',
      text: 'text-warning-ink',
    };
  }

  return {
    marker: 'bg-surface-2 text-ink-subtle border-hairline-strong',
    text: 'text-ink-subtle',
  };
}

function statusTone(statusLabel: string): string {
  if (statusLabel === 'Approved') {
    return 'bg-success-tint text-success-ink';
  }

  if (statusLabel === 'Generating plan') {
    return 'bg-warning-tint text-warning-ink';
  }

  return 'bg-primary-tint text-primary-ink';
}

function proposedStepTone(status: PmoWorkflowExecutionStepStatus): {
  circle: string;
  line: string;
  text: string;
} {
  if (status === 'completed') {
    return {
      circle: 'border-success bg-success text-white',
      line: 'bg-success/70',
      text: 'text-success-ink',
    };
  }

  if (status === 'in_progress') {
    return {
      circle: 'border-warning bg-warning-tint text-warning-ink ring-1 ring-warning/40',
      line: 'bg-warning/60',
      text: 'text-warning-ink',
    };
  }

  if (status === 'needs_review') {
    return {
      circle: 'border-primary bg-primary-tint text-primary-ink ring-1 ring-primary/30',
      line: 'bg-primary/50',
      text: 'text-primary-ink',
    };
  }

  if (status === 'failed') {
    return {
      circle: 'border-danger bg-danger-tint text-danger-ink',
      line: 'bg-danger/60',
      text: 'text-danger-ink',
    };
  }

  return {
    circle: 'border-hairline-strong bg-surface-2 text-ink-subtle',
    line: 'bg-hairline-strong',
    text: 'text-ink-subtle',
  };
}

function workflowStepTone(status: PmoWorkflowExecutionStepStatus): {
  badge: string;
  label: string;
} {
  if (status === 'completed') {
    return {
      badge: 'bg-success-tint text-success-ink',
      label: 'Completed',
    };
  }

  if (status === 'in_progress') {
    return {
      badge: 'bg-warning-tint text-warning-ink',
      label: 'In progress',
    };
  }

  if (status === 'failed') {
    return {
      badge: 'bg-danger-tint text-danger-ink',
      label: 'Failed',
    };
  }

  if (status === 'needs_review') {
    return {
      badge: 'bg-primary-tint text-primary-ink',
      label: 'Needs review',
    };
  }

  return {
    badge: 'bg-surface-2 text-ink-subtle',
    label: 'Pending',
  };
}

function documentStatusTone(status: PmoSessionDocumentProfileRecord['status']): {
  badge: string;
  label: string;
} {
  if (status === 'profiled') {
    return {
      badge: 'bg-success-tint text-success-ink',
      label: 'Profiled',
    };
  }

  if (status === 'profiling') {
    return {
      badge: 'bg-warning-tint text-warning-ink',
      label: 'Profiling',
    };
  }

  if (status === 'profile_failed') {
    return {
      badge: 'bg-danger-tint text-danger-ink',
      label: 'Profile failed',
    };
  }

  return {
    badge: 'bg-surface-2 text-ink-subtle',
    label: 'Uploaded',
  };
}

function buildExecutionCards(session: PmoPlanningSession | null): Array<{
  step_no: number;
  step_name: string;
  status: PmoWorkflowExecutionStepStatus;
  description?: string;
}> {
  if (!session?.plan) {
    return [];
  }

  if (session.execution_state?.steps?.length) {
    return session.execution_state.steps
      .slice()
      .sort((a, b) => a.step_no - b.step_no)
      .map((step) => ({
        step_no: step.step_no,
        step_name: step.step_name,
        status: step.status,
        description:
          session.plan?.proposed_workflow.find((item) => item.step_no === step.step_no)
            ?.description ?? '',
      }));
  }

  const sortedWorkflow = session.plan.proposed_workflow
    .slice()
    .sort((a, b) => a.step_no - b.step_no);
  if (sortedWorkflow.length === 0) {
    return [
      {
        step_no: 1,
        step_name: 'Workbook Profiling',
        status: session.planning_state === 'approved_plan' ? 'in_progress' : 'pending',
      },
    ];
  }

  return sortedWorkflow.map((step, index) => ({
    step_no: step.step_no,
    step_name: step.step_name,
    status:
      session.planning_state === 'approved_plan'
        ? index === 0
          ? 'in_progress'
          : 'pending'
        : 'pending',
    description: step.description,
  }));
}

function buildPlanTimeline(
  state: PmoPlanningSession['planning_state'] | null,
): Array<{ id: number; label: string; state: TimelineState }> {
  const labels = [
    'Upload workbook',
    'Analyze goal and build plan',
    'Plan review and regeneration',
    'Approve plan and move next step',
    'Execute next workflow steps',
  ];

  const mapState = (s: PmoPlanningSession['planning_state'] | null): TimelineState[] => {
    if (s === 'approved_plan') {
      return ['done', 'done', 'done', 'current', 'pending'];
    }

    if (s === 'plan_review') {
      return ['done', 'done', 'current', 'pending', 'pending'];
    }

    if (s === 'generating_plan') {
      return ['done', 'current', 'pending', 'pending', 'pending'];
    }

    return ['current', 'pending', 'pending', 'pending', 'pending'];
  };

  const states = mapState(state);
  return labels.map((label, index) => ({
    id: index + 1,
    label,
    state: states[index] ?? 'pending',
  }));
}

export function PmoPage() {
  const [reportingPeriodKey, setReportingPeriodKey] = useState('');
  const [goalDraft, setGoalDraft] = useState(
    'Ingest this workbook and prepare data for RA calculation.',
  );
  const [sessions, setSessions] = useState<PmoPlanningSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);

  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isAppendingDocument, setIsAppendingDocument] = useState(false);
  const [isSavingProfilingReview, setIsSavingProfilingReview] = useState(false);
  const [isApprovingProfiling, setIsApprovingProfiling] = useState(false);
  const [profilingOverridesBySessionId, setProfilingOverridesBySessionId] = useState<
    Record<string, Record<string, { finalArea: PmoProfilingArea; markIgnore: boolean }>>
  >({});
  const [waivedMissingAreasBySessionId, setWaivedMissingAreasBySessionId] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const [uploadedInfo, setUploadedInfo] = useState<{
    ingestionSessionId: string;
    fileName: string;
    fileSizeBytes: number;
    uploadedAtIso: string;
    fileType: string;
  } | null>(null);

  const [feedbackBySessionId, setFeedbackBySessionId] = useState<Record<string, string>>({});

  const selectedSession = useMemo(
    () =>
      sessions.find((row) => row.ingestion_session_id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  );

  const selectedFeedback = selectedSession
    ? (feedbackBySessionId[selectedSession.ingestion_session_id] ?? '')
    : '';

  const selectedUploadedSessionId =
    selectedSession?.planning_state === 'uploaded' ? selectedSession.ingestion_session_id : null;
  const targetGenerateSessionId = uploadedInfo?.ingestionSessionId ?? selectedUploadedSessionId;

  const timeline = buildPlanTimeline(selectedSession?.planning_state ?? null);
  const executionCards = buildExecutionCards(selectedSession);
  const executionState = selectedSession?.execution_state ?? null;
  const profilingDocuments = selectedSession?.profiling_documents.length
    ? selectedSession.profiling_documents
    : (executionState?.documents ?? []);
  const profilingSummary = selectedSession?.profiling_summary ?? executionState?.profiling_summary;
  const profilingReviewState =
    selectedSession?.profiling_review ?? executionState?.profiling_review;
  const selectedSessionOverrides = selectedSession
    ? (profilingOverridesBySessionId[selectedSession.ingestion_session_id] ?? {})
    : {};
  const selectedSessionWaivedMissingAreas = selectedSession
    ? (waivedMissingAreasBySessionId[selectedSession.ingestion_session_id] ?? {})
    : {};
  const hasOutstandingMissingAreas =
    (profilingSummary?.missing_recommended_data_areas ?? []).filter(
      (area) => !selectedSessionWaivedMissingAreas[area],
    ).length > 0;

  const feedbackHistoryItems = useMemo(() => {
    if (!selectedSession) {
      return [] as Array<{ key: string; feedback: string }>;
    }

    const duplicateCountByValue = new Map<string, number>();
    return selectedSession.feedback_history.map((feedback) => {
      const duplicateCount = (duplicateCountByValue.get(feedback) ?? 0) + 1;
      duplicateCountByValue.set(feedback, duplicateCount);

      return {
        key: `${selectedSession.ingestion_session_id}-feedback-${feedback}-${duplicateCount}`,
        feedback,
      };
    });
  }, [selectedSession]);

  const proposedWorkflowSteps = useMemo(() => {
    const sessionPlan = selectedSession?.plan;
    if (!sessionPlan?.proposed_workflow?.length) {
      return [] as PmoPlan['proposed_workflow'];
    }

    return sessionPlan.proposed_workflow.slice().sort((a, b) => a.step_no - b.step_no);
  }, [selectedSession]);

  const proposedStepStatusByNo = useMemo(() => {
    const map = new Map<number, PmoWorkflowExecutionStepStatus>();
    for (const step of executionState?.steps ?? []) {
      map.set(step.step_no, step.status);
    }
    return map;
  }, [executionState]);

  const loadSessions = useCallback(async (keepSelection = true) => {
    setIsLoadingSessions(true);
    try {
      const response = await pmoApi.listPlanningSessions();
      setSessions(response.items);
      const firstSessionId = response.items[0]?.ingestion_session_id ?? null;

      setSelectedSessionId((current) => {
        if (!keepSelection) {
          return firstSessionId;
        }

        if (!current) {
          return firstSessionId;
        }

        const exists = response.items.some((item) => item.ingestion_session_id === current);
        return exists ? current : firstSessionId;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load ingestion sessions.';
      toast.error('Failed to load sessions', { description: message });
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessions(false);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadSessions]);

  function refreshPage() {
    void loadSessions(true);
  }

  async function onFile(file: File) {
    setIsUploading(true);
    try {
      const uploaded = await pmoApi.uploadWorkbook(file, reportingPeriodKey || undefined);
      const nowIso = new Date().toISOString();
      const sessionId = uploaded.ingestion_session_id;

      setUploadedInfo({
        ingestionSessionId: sessionId,
        fileName: file.name,
        fileSizeBytes: file.size,
        uploadedAtIso: nowIso,
        fileType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      setSelectedSessionId(sessionId);
      setIsReviewPanelOpen(false);

      await loadSessions(true);

      toast.success('Workbook uploaded', {
        description: 'Analyze & Generate Plan is now enabled.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      toast.error('Upload failed', { description: message });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleAnalyzeGeneratePlan() {
    if (!targetGenerateSessionId) {
      toast.error('Upload required', {
        description: 'Please upload a workbook or select an Uploaded run before generating a plan.',
      });
      return;
    }

    if (isGenerating) {
      return;
    }

    const goal = goalDraft.trim() || 'Generate ingestion workflow plan from uploaded workbook.';

    setIsGenerating(true);
    try {
      const payload: GeneratePlanInput = {
        ingestion_session_id: targetGenerateSessionId,
        goal,
      };

      await pmoApi.generatePlan(payload);
      await loadSessions(true);
      setSelectedSessionId(targetGenerateSessionId);

      toast.success('Plan generated', {
        description: 'Upload history status moved to Plan Review.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan generation failed.';
      toast.error('Generate failed', { description: message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRegeneratePlan() {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'plan_review') {
      toast.error('Cannot regenerate', {
        description: 'Plan can be regenerated only in Plan Review state.',
      });
      return;
    }

    if (isGenerating) {
      return;
    }

    const goal =
      goalDraft.trim() || selectedSession.goal || 'Generate plan from uploaded workbook.';
    const feedback = (feedbackBySessionId[selectedSession.ingestion_session_id] ?? '').trim();

    setIsGenerating(true);
    try {
      await pmoApi.generatePlan({
        ingestion_session_id: selectedSession.ingestion_session_id,
        goal,
        previous_plan: selectedSession.plan,
        plan_feedback: feedback || undefined,
      });

      await loadSessions(true);
      toast.success('Plan regenerated', {
        description: 'Workflow stayed at Plan Review with a new plan version.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan regeneration failed.';
      toast.error('Regenerate failed', { description: message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleApprovePlanAndStart() {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'plan_review') {
      toast.error('Cannot approve', {
        description: 'Only Plan Review state can move to next workflow step.',
      });
      return;
    }

    if (isApproving) {
      return;
    }

    setIsApproving(true);
    try {
      const response = await pmoApi.approvePlan(selectedSession.ingestion_session_id);
      await loadSessions(true);
      toast.success('Plan approved', {
        description:
          response.execution_state.current_step_status === 'failed'
            ? 'Workflow started, but Workbook Profiling needs attention.'
            : 'Workflow started and Workbook Profiling has been processed.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan approval failed.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApproving(false);
    }
  }

  async function handleAppendDocument(file: File) {
    if (!selectedSession) {
      toast.error('No session selected', {
        description: 'Please select an approved session before appending a document.',
      });
      return;
    }

    if (selectedSession.planning_state !== 'approved_plan') {
      toast.error('Cannot append document', {
        description: 'Supplemental documents are allowed only after plan approval.',
      });
      return;
    }

    if (isAppendingDocument) {
      return;
    }

    setIsAppendingDocument(true);
    try {
      const response = await pmoApi.appendSessionDocument(
        selectedSession.ingestion_session_id,
        file,
      );

      await loadSessions(true);
      toast.success('Supplemental document processed', {
        description:
          response.document.status === 'profile_failed'
            ? 'Document uploaded, but profiling failed. Check the error in Workbook Profiling card.'
            : 'Document uploaded and profiled successfully in the current workflow session.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to append document.';
      toast.error('Append failed', { description: message });
    } finally {
      setIsAppendingDocument(false);
    }
  }

  async function handleSaveProfilingReview() {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'approved_plan') {
      toast.error('Cannot save review', {
        description: 'Profiling review is available only after plan approval.',
      });
      return;
    }

    if (isSavingProfilingReview) {
      return;
    }

    const sessionOverrides =
      profilingOverridesBySessionId[selectedSession.ingestion_session_id] ?? {};
    const overridesPayload: PmoProfilingSheetReviewOverride[] = Object.entries(sessionOverrides)
      .map(([key, value]) => {
        const [document_id, sheet_name] = key.split('::');
        if (!document_id || !sheet_name) {
          return null;
        }

        return {
          document_id,
          sheet_name,
          final_area: value.finalArea,
          mark_ignore: value.markIgnore,
        };
      })
      .filter((item): item is PmoProfilingSheetReviewOverride => Boolean(item));

    const waivedMap = waivedMissingAreasBySessionId[selectedSession.ingestion_session_id] ?? {};
    const waivedMissingAreas = Object.entries(waivedMap)
      .filter(([, waived]) => waived)
      .map(([area]) => area) as Array<Exclude<PmoProfilingArea, 'unknown'>>;

    setIsSavingProfilingReview(true);
    try {
      await pmoApi.updateProfilingReview({
        ingestion_session_id: selectedSession.ingestion_session_id,
        sheet_overrides: overridesPayload,
        waived_missing_areas: waivedMissingAreas,
      });
      await loadSessions(true);
      toast.success('Profiling review saved', {
        description: 'Review edits were persisted. Gate remains in Needs Review until approval.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save profiling review.';
      toast.error('Save failed', { description: message });
    } finally {
      setIsSavingProfilingReview(false);
    }
  }

  async function handleApproveProfilingContinue() {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'approved_plan') {
      toast.error('Cannot continue', {
        description: 'Profiling gate is available only after plan approval.',
      });
      return;
    }

    if (hasOutstandingMissingAreas) {
      toast.error('Missing required context', {
        description:
          'Please upload supplemental workbook(s) or waive remaining missing data areas before continuing.',
      });
      return;
    }

    if (isApprovingProfiling) {
      return;
    }

    setIsApprovingProfiling(true);
    try {
      await pmoApi.approveProfilingContinue(selectedSession.ingestion_session_id);
      await loadSessions(true);
      toast.success('Profiling approved', {
        description: 'Workbook Profiling gate approved. Workflow moved to the next step.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve profiling gate.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApprovingProfiling(false);
    }
  }

  const plan: PmoPlan | null = selectedSession?.plan ?? null;

  return (
    <PageChrome
      breadcrumb={['Work']}
      title="PMO Ingestion"
      subtitle="Persisted state workflow: upload -> generate plan -> review/regenerate -> approve."
      actions={
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={refreshPage}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="min-h-full bg-surface-1 px-4 py-5 pb-8 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3">
          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-md bg-primary-tint p-2 text-primary">
                <Workflow className="size-5" />
              </span>
              <div>
                <h2 className="text-body-sm font-semibold text-ink">Workflow path</h2>
                <p className="mt-0.5 text-body-sm text-ink-subtle">
                  Upload workbook, generate plan from Goal via LLM, review/regenerate, then approve.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="reporting-period-key">Reporting period key (optional)</Label>
                  <Input
                    id="reporting-period-key"
                    value={reportingPeriodKey}
                    onChange={(e) => setReportingPeriodKey(e.target.value)}
                    placeholder="e.g. 2025-W35"
                    disabled={isUploading || isGenerating}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pmo-goal-input">Goal</Label>
                    <span className="text-caption text-ink-subtle">{goalDraft.length} / 500</span>
                  </div>
                  <Textarea
                    id="pmo-goal-input"
                    rows={3}
                    maxLength={500}
                    value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value)}
                    className="resize-none"
                    placeholder="Describe what the PMO assistant should generate for this workbook."
                    disabled={isGenerating}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={handleAnalyzeGeneratePlan}
                    disabled={!targetGenerateSessionId || isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Generating plan...
                      </>
                    ) : (
                      'Analyze & generate plan'
                    )}
                  </Button>

                  <span className="rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-caption text-ink-subtle">
                    {targetGenerateSessionId
                      ? 'Ready to generate plan'
                      : 'Upload workbook or select an Uploaded run'}
                  </span>
                </div>
              </section>

              <Dropzone
                accept={ACCEPT}
                maxBytes={MAX_BYTES}
                label="Drop PMO workbook here, or click to choose"
                hint="XLSX / XLSM · up to 50 MB"
                pendingLabel="Uploading workbook..."
                tooLargeMessage="That file is over 50 MB. Try a smaller workbook."
                isPending={isUploading}
                onFile={onFile}
              />
            </div>

            {uploadedInfo ? (
              <section className="mt-3 rounded-lg border border-hairline bg-surface-1 p-3 text-caption">
                <h3 className="text-body-sm font-semibold text-ink">Uploaded workbook</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <p className="text-ink-subtle">
                    Session:{' '}
                    <span className="font-medium text-ink">{uploadedInfo.ingestionSessionId}</span>
                  </p>
                  <p className="text-ink-subtle">
                    Name: <span className="font-medium text-ink">{uploadedInfo.fileName}</span>
                  </p>
                  <p className="text-ink-subtle">
                    Size:{' '}
                    <span className="font-medium text-ink">
                      {formatBytes(uploadedInfo.fileSizeBytes)}
                    </span>
                  </p>
                  <p className="text-ink-subtle">
                    Uploaded at:{' '}
                    <span className="font-medium text-ink">
                      {formatLocalDate(uploadedInfo.uploadedAtIso)}
                    </span>
                  </p>
                </div>
              </section>
            ) : null}
          </section>

          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-body-sm font-semibold text-ink">Upload history</h3>
                <p className="text-caption text-ink-subtle">
                  Persisted sessions. View opens Plan tab first.
                </p>
              </div>
              {isLoadingSessions ? (
                <span className="inline-flex items-center gap-1 text-caption text-ink-subtle">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading...
                </span>
              ) : null}
            </div>

            {sessions.length === 0 ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                No runs yet. Upload a workbook and click Analyze &amp; Generate Plan.
              </section>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-body-sm">
                  <thead className="border-b border-hairline text-caption uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">Workbook</th>
                      <th className="px-2 py-2">Uploaded at</th>
                      <th className="px-2 py-2">Operator</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Active gate</th>
                      <th className="px-2 py-2">Progress</th>
                      <th className="px-2 py-2">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((run, index) => {
                      const selected =
                        run.ingestion_session_id === selectedSession?.ingestion_session_id;
                      return (
                        <tr
                          key={run.ingestion_session_id}
                          className={`cursor-pointer border-b border-hairline ${
                            selected ? 'bg-primary-tint/30' : ''
                          }`}
                          onClick={() => setSelectedSessionId(run.ingestion_session_id)}
                        >
                          <td className="px-2 py-2 text-ink-subtle">{index + 1}</td>
                          <td className="px-2 py-2 font-medium text-ink">{run.workbook_name}</td>
                          <td className="px-2 py-2 text-ink-subtle">
                            {formatLocalDate(run.uploaded_at)}
                          </td>
                          <td className="px-2 py-2 text-ink-subtle">{run.operator}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-caption font-medium ${statusTone(run.status_label)}`}
                            >
                              {run.status_label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-ink-subtle">{run.active_gate}</td>
                          <td className="px-2 py-2">
                            <div className="w-[170px]">
                              <p className="text-caption text-ink-subtle">{run.progress_text}</p>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                                <div
                                  className="h-full rounded-full bg-success"
                                  style={{ width: `${run.progress_pct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSessionId(run.ingestion_session_id);
                                setIsReviewPanelOpen(true);
                              }}
                            >
                              View
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            {!isReviewPanelOpen ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                Select one run and click View to open Plan tab.
              </section>
            ) : !selectedSession ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                Selected run was not found.
              </section>
            ) : (
              <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-body-sm font-semibold text-ink">Plan</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-caption font-medium ${statusTone(selectedSession.status_label)}`}
                  >
                    {selectedSession.status_label}
                  </span>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-caption text-ink-subtle">
                    Version {Math.max(1, selectedSession.plan_version)}
                  </span>
                </div>

                <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <p className="text-ink">
                      <span className="font-semibold">Interpreted goal:</span>{' '}
                      {(plan?.goal_summary ?? selectedSession.goal) || goalDraft}
                    </p>
                    <p className="text-success-ink">
                      <span className="font-semibold">Plan status:</span>{' '}
                      {selectedSession.status_label}
                    </p>
                  </div>
                  <p className="mt-1 text-ink-subtle">
                    {plan?.title ?? 'Plan will appear here after Analyze & Generate Plan.'}
                  </p>
                </div>

                <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {timeline.map((step) => {
                    const tone = toneForState(step.state);
                    const stateLabel =
                      step.state === 'done'
                        ? 'Done'
                        : step.state === 'current'
                          ? 'In progress'
                          : 'Pending';

                    return (
                      <li
                        key={step.id}
                        className="rounded-lg border border-hairline bg-canvas px-2.5 py-2 text-caption"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-0.5 flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold ${tone.marker}`}
                          >
                            {step.state === 'done' ? (
                              <CheckCircle2 className="size-3.5" />
                            ) : step.state === 'pending' ? (
                              <Circle className="size-3.5" />
                            ) : (
                              step.id
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{step.label}</p>
                            <p className={`mt-0.5 ${tone.text}`}>{stateLabel}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {selectedSession.planning_state === 'generating_plan' ? (
                  <div className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
                    <Loader2 className="size-4 animate-spin" />
                    Generating plan from Goal and uploaded file metadata...
                  </div>
                ) : null}

                {executionCards.length > 0 ? (
                  <section className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption text-ink-subtle">
                    <p className="font-medium text-ink">Workflow execution</p>
                    <p className="mt-1">
                      Step cards are derived from the approved plan. Only the active step is
                      interactive.
                    </p>

                    <ol className="mt-2 grid gap-2 md:grid-cols-2">
                      {executionCards.map((step) => {
                        const tone = workflowStepTone(step.status);
                        const isCurrent =
                          step.step_no ===
                          (executionState?.current_step_no ?? executionCards[0]?.step_no);
                        const isWorkbookProfilingStep =
                          step.step_no === 1 || /workbook\s*profil/i.test(step.step_name);

                        return (
                          <li
                            key={`${selectedSession.ingestion_session_id}-workflow-step-${step.step_no}`}
                            className="rounded-lg border border-hairline bg-surface-1 px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-medium text-ink">
                                  Step {step.step_no}: {step.step_name}
                                </p>
                                {step.description ? (
                                  <p className="mt-0.5 text-ink-subtle">{step.description}</p>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {isCurrent ? (
                                  <span className="rounded-full bg-primary-tint px-2 py-0.5 text-caption font-medium text-primary-ink">
                                    Active
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded-full px-2 py-0.5 text-caption font-medium ${tone.badge}`}
                                >
                                  {tone.label}
                                </span>
                              </div>
                            </div>

                            {isWorkbookProfilingStep ? (
                              <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium text-ink">Workbook Profiling details</p>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
                                  >
                                    {workflowStepTone(step.status).label}
                                  </span>
                                  {profilingReviewState ? (
                                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-subtle">
                                      Review:{' '}
                                      {profilingReviewState.status === 'approved'
                                        ? 'Approved'
                                        : 'Needs review'}
                                    </span>
                                  ) : null}
                                </div>

                                {profilingSummary ? (
                                  <div className="grid gap-2 text-ink-subtle sm:grid-cols-2 lg:grid-cols-4">
                                    <p>
                                      Documents:{' '}
                                      <span className="font-medium text-ink">
                                        {profilingSummary.profiled_document_count} /
                                        {profilingSummary.document_count}
                                      </span>
                                    </p>
                                    <p>
                                      Sheets:{' '}
                                      <span className="font-medium text-ink">
                                        {profilingSummary.total_sheet_count}
                                      </span>
                                    </p>
                                    <p>
                                      Rows:{' '}
                                      <span className="font-medium text-ink">
                                        {profilingSummary.total_row_count}
                                      </span>
                                    </p>
                                    <p>
                                      Generated:{' '}
                                      <span className="font-medium text-ink">
                                        {formatLocalDate(profilingSummary.generated_at)}
                                      </span>
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-ink-subtle">
                                    No profiling summary yet. Approve plan to start profiling.
                                  </p>
                                )}

                                {profilingSummary?.detected_data_areas.length ? (
                                  <p>
                                    Detected data areas:{' '}
                                    <span className="font-medium text-ink">
                                      {profilingSummary.detected_data_areas.join(', ')}
                                    </span>
                                  </p>
                                ) : null}

                                {profilingSummary?.missing_recommended_data_areas.length ? (
                                  <div className="space-y-1 rounded-md border border-hairline bg-surface-1 p-2">
                                    <p className="font-medium text-ink">
                                      Missing recommended data areas
                                    </p>
                                    <ul className="space-y-1">
                                      {profilingSummary.missing_recommended_data_areas.map(
                                        (area) => {
                                          const waived = Boolean(
                                            selectedSessionWaivedMissingAreas[area],
                                          );
                                          return (
                                            <li
                                              key={`${selectedSession.ingestion_session_id}-missing-${area}`}
                                            >
                                              <label className="flex cursor-pointer items-center justify-between gap-2">
                                                <span className="text-ink-subtle">
                                                  <span className="font-medium text-ink">
                                                    {area}
                                                  </span>
                                                </span>
                                                <span className="inline-flex items-center gap-1 text-caption text-ink-subtle">
                                                  <input
                                                    type="checkbox"
                                                    checked={waived}
                                                    onChange={(event) => {
                                                      const checked = event.target.checked;
                                                      setWaivedMissingAreasBySessionId((prev) => ({
                                                        ...prev,
                                                        [selectedSession.ingestion_session_id]: {
                                                          ...(prev[
                                                            selectedSession.ingestion_session_id
                                                          ] ?? {}),
                                                          [area]: checked,
                                                        },
                                                      }));
                                                    }}
                                                  />
                                                  Mark as not required
                                                </span>
                                              </label>
                                            </li>
                                          );
                                        },
                                      )}
                                    </ul>
                                  </div>
                                ) : null}

                                {profilingSummary?.suggested_next_step ? (
                                  <p>
                                    Recommendation:{' '}
                                    <span className="font-medium text-ink">
                                      {profilingSummary.suggested_next_step}
                                    </span>
                                  </p>
                                ) : null}

                                <div className="space-y-1.5">
                                  <p className="font-medium text-ink">Profiled documents</p>
                                  {profilingDocuments.length === 0 ? (
                                    <p className="text-ink-subtle">No document records yet.</p>
                                  ) : (
                                    <ul className="space-y-1.5">
                                      {profilingDocuments.map((doc) => {
                                        const docTone = documentStatusTone(doc.status);
                                        const sheetCount =
                                          doc.profile_result?.workbook_summary.sheet_count ?? 0;
                                        const rowCount =
                                          doc.profile_result?.workbook_summary.total_rows ?? 0;

                                        return (
                                          <li
                                            key={doc.document_id}
                                            className="rounded-md border border-hairline bg-surface-1 px-2 py-1.5"
                                          >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <p className="font-medium text-ink">
                                                {doc.file_name}
                                              </p>
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-caption font-medium ${docTone.badge}`}
                                              >
                                                {docTone.label}
                                              </span>
                                            </div>
                                            <div className="mt-1 grid gap-1 text-ink-subtle sm:grid-cols-3">
                                              <p>Uploaded: {formatLocalDate(doc.uploaded_at)}</p>
                                              <p>Sheets: {sheetCount}</p>
                                              <p>Rows: {rowCount}</p>
                                            </div>
                                            {doc.profile_result?.sheets.length ? (
                                              <div className="mt-2 overflow-x-auto">
                                                <table className="min-w-full text-left text-caption">
                                                  <thead className="border-b border-hairline text-ink-subtle">
                                                    <tr>
                                                      <th className="px-1.5 py-1">Sheet</th>
                                                      <th className="px-1.5 py-1">
                                                        Predicted meaning
                                                      </th>
                                                      <th className="px-1.5 py-1">Confidence</th>
                                                      <th className="px-1.5 py-1">Action</th>
                                                      <th className="px-1.5 py-1">Override</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {doc.profile_result.sheets.map((sheet) => {
                                                      const key = profilingSheetKey(
                                                        doc.document_id,
                                                        sheet.sheet_name,
                                                      );
                                                      const override =
                                                        selectedSessionOverrides[key];
                                                      const effectiveArea = override?.markIgnore
                                                        ? 'unknown'
                                                        : (override?.finalArea ??
                                                          sheet.final_decision?.area ??
                                                          sheet.candidate_business_area);

                                                      return (
                                                        <tr
                                                          key={`${doc.document_id}-${sheet.sheet_name}`}
                                                          className="border-b border-hairline"
                                                        >
                                                          <td className="px-1.5 py-1 text-ink">
                                                            {sheet.sheet_name}
                                                          </td>
                                                          <td className="px-1.5 py-1 text-ink-subtle">
                                                            {sheet.likely_purpose}
                                                          </td>
                                                          <td className="px-1.5 py-1 text-ink-subtle">
                                                            {sheet.final_decision?.confidence ??
                                                              (sheet.confidence >= 0.8
                                                                ? 'high'
                                                                : sheet.confidence >= 0.55
                                                                  ? 'medium'
                                                                  : 'low')}
                                                          </td>
                                                          <td className="px-1.5 py-1 text-ink-subtle">
                                                            {sheet.llm_interpretation
                                                              ?.recommended_action ?? 'review'}
                                                          </td>
                                                          <td className="px-1.5 py-1">
                                                            <div className="flex flex-wrap items-center gap-1">
                                                              <select
                                                                className="rounded border border-hairline bg-canvas px-1 py-0.5 text-caption"
                                                                value={effectiveArea}
                                                                onChange={(event) => {
                                                                  const selectedArea = event.target
                                                                    .value as PmoProfilingArea;
                                                                  setProfilingOverridesBySessionId(
                                                                    (prev) => ({
                                                                      ...prev,
                                                                      [selectedSession.ingestion_session_id]:
                                                                        {
                                                                          ...(prev[
                                                                            selectedSession
                                                                              .ingestion_session_id
                                                                          ] ?? {}),
                                                                          [key]: {
                                                                            finalArea: selectedArea,
                                                                            markIgnore:
                                                                              selectedArea ===
                                                                              'unknown',
                                                                          },
                                                                        },
                                                                    }),
                                                                  );
                                                                }}
                                                              >
                                                                {PROFILING_AREAS.map((area) => (
                                                                  <option key={area} value={area}>
                                                                    {area}
                                                                  </option>
                                                                ))}
                                                              </select>
                                                              <label className="inline-flex items-center gap-1 text-caption text-ink-subtle">
                                                                <input
                                                                  type="checkbox"
                                                                  checked={Boolean(
                                                                    override?.markIgnore,
                                                                  )}
                                                                  onChange={(event) => {
                                                                    const checked =
                                                                      event.target.checked;
                                                                    setProfilingOverridesBySessionId(
                                                                      (prev) => ({
                                                                        ...prev,
                                                                        [selectedSession.ingestion_session_id]:
                                                                          {
                                                                            ...(prev[
                                                                              selectedSession
                                                                                .ingestion_session_id
                                                                            ] ?? {}),
                                                                            [key]: {
                                                                              finalArea: checked
                                                                                ? 'unknown'
                                                                                : (override?.finalArea ??
                                                                                  sheet
                                                                                    .final_decision
                                                                                    ?.area ??
                                                                                  sheet.candidate_business_area),
                                                                              markIgnore: checked,
                                                                            },
                                                                          },
                                                                      }),
                                                                    );
                                                                  }}
                                                                />
                                                                Ignore
                                                              </label>
                                                            </div>
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </div>
                                            ) : null}
                                            {doc.error_message ? (
                                              <p className="mt-1 text-danger-ink">
                                                Error: {doc.error_message}
                                              </p>
                                            ) : null}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>

                                {isCurrent && selectedSession.planning_state === 'approved_plan' ? (
                                  <div className="space-y-2">
                                    <Dropzone
                                      accept={ACCEPT}
                                      maxBytes={MAX_BYTES}
                                      label="Upload supplemental workbook to this session"
                                      hint="The new document is appended and profiled without restarting workflow"
                                      pendingLabel="Uploading and profiling..."
                                      tooLargeMessage="That file is over 50 MB. Try a smaller workbook."
                                      isPending={isAppendingDocument}
                                      onFile={handleAppendDocument}
                                    />

                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        onClick={handleSaveProfilingReview}
                                        disabled={isSavingProfilingReview}
                                      >
                                        {isSavingProfilingReview ? (
                                          <>
                                            <Loader2 className="size-4 animate-spin" />
                                            Saving review...
                                          </>
                                        ) : (
                                          'Save profiling review'
                                        )}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="primary"
                                        onClick={handleApproveProfilingContinue}
                                        disabled={
                                          isApprovingProfiling ||
                                          hasOutstandingMissingAreas ||
                                          step.status !== 'needs_review'
                                        }
                                      >
                                        {isApprovingProfiling ? (
                                          <>
                                            <Loader2 className="size-4 animate-spin" />
                                            Approving profiling...
                                          </>
                                        ) : (
                                          'Approve Profiling & Continue'
                                        )}
                                      </Button>
                                      {hasOutstandingMissingAreas ? (
                                        <span className="text-caption text-warning-ink">
                                          Outstanding missing data areas remain. Upload documents or
                                          waive them first.
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <p className="mt-2 rounded-md border border-dashed border-hairline-strong bg-canvas px-2 py-1.5 text-ink-subtle">
                                This step is planned and read-only for now. Implementation will be
                                added in subsequent iteration.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ) : null}

                {plan ? (
                  <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption text-ink-subtle">
                    <p className="font-medium text-ink">Proposed workflow</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-4">
                      {plan.proposed_workflow.map((step) => (
                        <li key={`${selectedSession.ingestion_session_id}-step-${step.step_no}`}>
                          <span className="font-medium text-ink">{step.step_name}</span>:{' '}
                          {step.description}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-2">
                      Last generated:{' '}
                      <span className="text-ink">
                        {formatLocalDate(selectedSession.plan_generated_at)}
                      </span>
                    </p>
                  </div>
                ) : null}

                {proposedWorkflowSteps.length > 0 ? (
                  <section className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption text-ink-subtle">
                    <p className="font-medium text-ink">Proposed workflow visual</p>
                    <p className="mt-1">
                      Steps are connected in order to make flow progression easier to scan.
                    </p>

                    <div className="mt-3 overflow-x-auto pb-1">
                      <ol className="grid min-w-[520px] grid-cols-2 gap-x-2 gap-y-3 md:flex md:min-w-max md:items-start md:gap-0">
                        {proposedWorkflowSteps.map((step, index) => {
                          const isLast = index === proposedWorkflowSteps.length - 1;
                          const stepStatus =
                            proposedStepStatusByNo.get(step.step_no) ??
                            (selectedSession?.planning_state === 'approved_plan' &&
                            step.step_no === 1
                              ? 'in_progress'
                              : 'pending');
                          const tone = proposedStepTone(stepStatus);

                          return (
                            <li
                              key={`${selectedSession.ingestion_session_id}-proposed-visual-step-${step.step_no}`}
                              className="flex items-start"
                            >
                              <div className="flex w-[140px] shrink-0 flex-col items-center">
                                <span
                                  className={`flex size-9 items-center justify-center rounded-full border text-body-sm font-semibold ${tone.circle}`}
                                >
                                  {step.step_no}
                                </span>
                                <p
                                  className={`mt-2 px-1 text-center text-caption font-medium ${tone.text}`}
                                >
                                  {step.step_name}
                                </p>
                              </div>
                              {!isLast ? (
                                <span
                                  aria-hidden="true"
                                  className={`mt-[18px] hidden h-0.5 w-10 shrink-0 md:block ${tone.line}`}
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </section>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="plan-feedback">Plan feedback</Label>
                    <Textarea
                      id="plan-feedback"
                      rows={2}
                      value={selectedFeedback}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setFeedbackBySessionId((prev) => ({
                          ...prev,
                          [selectedSession.ingestion_session_id]: nextValue,
                        }));
                      }}
                      placeholder="Example: Keep only validation and do not continue to DB write yet."
                      disabled={isGenerating || selectedSession.planning_state === 'approved_plan'}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleRegeneratePlan}
                      disabled={selectedSession.planning_state !== 'plan_review' || isGenerating}
                    >
                      Regenerate plan
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={handleApprovePlanAndStart}
                      disabled={selectedSession.planning_state !== 'plan_review' || isApproving}
                    >
                      {isApproving ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Approving...
                        </>
                      ) : (
                        'Approve plan & start'
                      )}
                    </Button>
                  </div>
                </div>

                {selectedSession.feedback_history.length > 0 ? (
                  <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption">
                    <p className="font-medium text-ink">Feedback history</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-ink-subtle">
                      {feedbackHistoryItems.map((item) => (
                        <li key={item.key}>{item.feedback}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            )}
          </section>
        </div>
      </div>
    </PageChrome>
  );
}
