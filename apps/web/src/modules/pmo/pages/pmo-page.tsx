import { Button, Dropzone, Input, Label, PageChrome, Textarea, toast } from '@seta/shared-ui';
import { CheckCircle2, Circle, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type GeneratePlanInput,
  type PmoPlan,
  type PmoPlanningSession,
  pmoApi,
} from '../api/client';

const ACCEPT = '.xlsx,.xlsm';
const MAX_BYTES = 50 * 1024 * 1024;

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
    void loadSessions(false);
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
      await pmoApi.approvePlan(selectedSession.ingestion_session_id);
      await loadSessions(true);
      toast.success('Plan approved', {
        description: 'Workflow moved to the next step marker.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan approval failed.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApproving(false);
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
