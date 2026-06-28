import { Button, Input, Label, toast } from '@seta/shared-ui';
import { useMemo, useState } from 'react';
import type {
  PmoPlan,
  PmoPlanningSession,
  PmoProfilingArea,
  PmoProfilingReviewState,
  PmoSessionDocumentProfileRecord,
  PmoWorkbookProfilingSessionSummary,
  PmoWorkflowExecutionStepStatus,
} from '../api/client';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import { usePmoReport, useRetryPmoReport } from '../hooks/use-pmo-report';
import type { GroupedMappingItemsBySheet } from '../hooks/use-pmo-workflow-runtime';
import {
  type ExecutionCard,
  executionStepMatchesRuntimeStep,
  type MappingAlternateOption,
  type MappingProgressItem,
  type MappingViewModel,
  type NormalizationReviewViewModel,
  type PmoPlanActionId,
  type PublishReviewViewModel,
  parseMappingView,
  parseNormalizationReviewView,
  parsePublishReviewView,
  readAgentNoteFromApproval,
  readClarificationsFromApproval,
  workflowStepTone,
} from '../pages/pmo-page.logic';
import { PmoExecutionPlanSnapshot } from './pmo-execution-plan-snapshot';
import { PmoMappingReviewPanel } from './pmo-mapping-review-panel';
import { PmoNormalizationReviewPanel } from './pmo-normalization-review-panel';
import {
  PmoProfilingDetailsPanel,
  type ProfilingOverrideEntry,
} from './pmo-profiling-details-panel';
import { PmoPublishReviewPanel } from './pmo-publish-review-panel';
import { ReportStatusCard } from './pmo-report-panel';

function CardClarificationPanel({
  approval,
  isCurrent,
  onClarify,
}: {
  approval: WorkflowApprovalRow | null;
  isCurrent: boolean;
  onClarify?: (message: string) => void;
}) {
  const [text, setText] = useState('');
  if (!approval) return null;

  const agentNote = readAgentNoteFromApproval(approval);
  const clarifications = readClarificationsFromApproval(approval);
  const hasMessages = Boolean(agentNote) || clarifications.length > 0;
  const canSend = isCurrent && approval.status === 'pending' && onClarify;

  if (!hasMessages && !canSend) return null;

  return (
    <div className="mb-3 rounded-lg border border-hairline bg-surface-1">
      <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2">
        {agentNote ? (
          <div className="flex gap-2">
            <span className="shrink-0 text-caption font-semibold text-primary-ink">Agent:</span>
            <p className="text-caption text-ink">{agentNote}</p>
          </div>
        ) : null}
        {clarifications.map((msg) => (
          <div key={msg.ts} className="flex gap-2">
            <span
              className={`shrink-0 text-caption font-semibold ${msg.role === 'agent' ? 'text-primary-ink' : 'text-ink'}`}
            >
              {msg.role === 'agent' ? 'Agent:' : 'You:'}
            </span>
            <p className="text-caption text-ink">{msg.message}</p>
          </div>
        ))}
      </div>
      {canSend ? (
        <div className="flex items-center gap-1.5 border-t border-hairline px-3 py-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                onClarify(text.trim());
                setText('');
              }
            }}
            placeholder="Type your message..."
            className="flex-1 rounded-md border border-hairline-strong bg-canvas px-2.5 py-1.5 text-body-sm text-ink placeholder:text-ink-tertiary focus:border-primary-border focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (text.trim()) {
                onClarify(text.trim());
                setText('');
              }
            }}
            disabled={!text.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-body-sm font-semibold text-on-primary disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface PmoExecutionStepRuntimeProps {
  executionCurrentStepNo: number | null;
  executionCurrentStepStatus: PmoWorkflowExecutionStepStatus | null;
  firstExecutionStepNo: number | null;
  runtimeActiveStepId: string | null;
  hasRuntimeCurrentStepMatch: boolean;
  approvalByActionId: Partial<Record<PmoPlanActionId, WorkflowApprovalRow>>;
}

export interface PmoExecutionStepMappingProps {
  selectedMappingApproval: WorkflowApprovalRow | null;
  mappingApprovalsCount: number;
  groupedMappingItems: GroupedMappingItemsBySheet[];
  selectedMappingView: MappingViewModel | null;
  editingMappingKey: string | null;
  selectedMappingAlternate: number | null;
  editingMappingItem: MappingProgressItem | null;
  editingMappingAlternates: MappingAlternateOption[];
  selectedAlternateOption: MappingAlternateOption | null;
  canProceedToNextStep: boolean;
  isSubmittingDecision: boolean;
  approveCurrentMappingItem: () => void;
  openMappingModify: (itemKey: string) => void;
  applyMappingModify: () => void;
  proceedToNextWorkflowStep: () => void;
  selectMappingAlternate: (alternateIndex: number) => void;
  cancelMappingModify: () => void;
}

export interface PmoExecutionStepNormalizationProps {
  selectedNormalizationApproval: WorkflowApprovalRow | null;
  normalizationApprovalsCount: number;
  selectedNormalizationView: NormalizationReviewViewModel | null;
  memberAdditionDrafts: Array<{
    member_id: string;
    full_name: string;
    department: string;
    role_title: string;
  }>;
  canApproveNormalization: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateMemberAdditionDraft: (
    memberId: string,
    field: 'full_name' | 'department' | 'role_title',
    value: string,
  ) => void;
  updateNormalizationRowDecision: (rowId: string, decision: 'keep_row' | 'skip_row') => void;
  updateNormalizationRowValue: (rowId: string, columnKey: string, value: string) => void;
  resetNormalizationRowOverrides: (rowId: string) => void;
  approveNormalization: () => void;
  rejectNormalization: () => void;
}

export interface PmoExecutionStepPublishProps {
  selectedPublishApproval: WorkflowApprovalRow | null;
  publishApprovalsCount: number;
  selectedPublishView: PublishReviewViewModel | null;
  isSubmittingPublishDecision: boolean;
  approvePublish: () => void;
  rejectPublish: () => void;
}

export interface PmoExecutionStepReportProps {
  selectedReportApproval: WorkflowApprovalRow | null;
  reportApprovalsCount: number;
  isSubmittingReportDecision: boolean;
  confirmReportRange: (
    ranges: {
      workloadDateRange?: { from: string; to: string };
      forwardAllocationDateRange?: { from: string; to: string };
    },
    strategy?: 'sheet_derived' | 'manual_database',
  ) => void;
  rejectReportRange: () => void;
}

export interface PmoExecutionStepProfilingProps {
  profilingReviewState: PmoProfilingReviewState | null | undefined;
  profilingSummary: PmoWorkbookProfilingSessionSummary | null | undefined;
  profilingDocuments: PmoSessionDocumentProfileRecord[];
  selectedSessionOverrides: Record<string, ProfilingOverrideEntry>;
  profilingAreas: PmoProfilingArea[];
  isAppendingDocument: boolean;
  isSavingProfilingReview: boolean;
  isApprovingProfiling: boolean;
  dropzoneAccept: string;
  dropzoneMaxBytes: number;
  handleAppendDocument: (file: File) => Promise<void>;
  handleSaveProfilingReview: () => Promise<void>;
  handleApproveProfilingContinue: () => Promise<void>;
  onSelectSheetArea: (
    documentId: string,
    sheetName: string,
    selectedArea: PmoProfilingArea,
  ) => void;
  onToggleSheetIgnore: (
    documentId: string,
    sheetName: string,
    checked: boolean,
    fallbackArea: PmoProfilingArea,
  ) => void;
}

export interface PmoExecutionStepPlanProps {
  plan: PmoPlan | null;
  goalDraft: string;
}

interface PmoExecutionStepCardProps {
  selectedSession: PmoPlanningSession;
  step: ExecutionCard;
  /** When true, all panels render in read-only mode (no approve/reject/edit). */
  readOnly?: boolean;
  runtime: PmoExecutionStepRuntimeProps;
  mapping: PmoExecutionStepMappingProps;
  normalization: PmoExecutionStepNormalizationProps;
  publish: PmoExecutionStepPublishProps;
  report: PmoExecutionStepReportProps;
  profiling: PmoExecutionStepProfilingProps;
  plan: PmoExecutionStepPlanProps;
  submitClarification?: (approvalId: string, message: string) => void;
}

function readReportRangeConfigFromApproval(approval: WorkflowApprovalRow | null): {
  bounds: { min: string; max: string } | null;
  source: 'database' | 'sheet_or_database';
  sections: Array<{
    kind: 'workload' | 'forward_allocation';
    title: string;
    description: string;
    suggestedDateRange: { from: string; to: string };
  }>;
} | null {
  const payload = approval?.proposedPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const primary = (payload as { primary?: unknown }).primary;
  if (!primary || typeof primary !== 'object' || Array.isArray(primary)) return null;
  const argsPatch = (primary as { argsPatch?: unknown }).argsPatch;
  if (!argsPatch || typeof argsPatch !== 'object' || Array.isArray(argsPatch)) return null;
  const rawBounds = (argsPatch as { databaseDateBounds?: unknown }).databaseDateBounds;
  const bounds =
    rawBounds && typeof rawBounds === 'object' && !Array.isArray(rawBounds)
      ? {
          min: String((rawBounds as { min?: unknown }).min ?? ''),
          max: String((rawBounds as { max?: unknown }).max ?? ''),
        }
      : null;
  const rawSource = (argsPatch as { rangeSource?: unknown }).rangeSource;
  const rawSections = (argsPatch as { reportSections?: unknown }).reportSections;
  const sections = Array.isArray(rawSections)
    ? rawSections
        .map((section) => {
          if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
          const record = section as {
            kind?: unknown;
            title?: unknown;
            description?: unknown;
            suggestedDateRange?: unknown;
          };
          const suggestedDateRange = record.suggestedDateRange;
          if (
            !suggestedDateRange ||
            typeof suggestedDateRange !== 'object' ||
            Array.isArray(suggestedDateRange)
          ) {
            return null;
          }
          const from = (suggestedDateRange as { from?: unknown }).from;
          const to = (suggestedDateRange as { to?: unknown }).to;
          if (
            (record.kind !== 'workload' && record.kind !== 'forward_allocation') ||
            typeof record.title !== 'string' ||
            typeof record.description !== 'string' ||
            typeof from !== 'string' ||
            typeof to !== 'string'
          ) {
            return null;
          }
          return {
            kind: record.kind,
            title: record.title,
            description: record.description,
            suggestedDateRange: { from, to },
          };
        })
        .filter(
          (
            section,
          ): section is {
            kind: 'workload' | 'forward_allocation';
            title: string;
            description: string;
            suggestedDateRange: { from: string; to: string };
          } => Boolean(section),
        )
    : [];
  return {
    bounds: bounds?.min && bounds.max ? bounds : null,
    source: rawSource === 'sheet_or_database' ? 'sheet_or_database' : 'database',
    sections,
  };
}

function PmoReportRangeForm(props: {
  stepNo: number;
  rangeConfig: ReturnType<typeof readReportRangeConfigFromApproval>;
  isSubmittingReportDecision: boolean;
  confirmReportRange: (
    ranges: {
      workloadDateRange?: { from: string; to: string };
      forwardAllocationDateRange?: { from: string; to: string };
    },
    strategy?: 'sheet_derived' | 'manual_database',
  ) => void;
  rejectReportRange: () => void;
}) {
  const { stepNo, rangeConfig, isSubmittingReportDecision, confirmReportRange, rejectReportRange } =
    props;
  const workloadSection = rangeConfig?.sections.find((section) => section.kind === 'workload');
  const forwardAllocationSection = rangeConfig?.sections.find(
    (section) => section.kind === 'forward_allocation',
  );
  const [workloadFrom, setWorkloadFrom] = useState(workloadSection?.suggestedDateRange.from ?? '');
  const [workloadTo, setWorkloadTo] = useState(workloadSection?.suggestedDateRange.to ?? '');
  const [forwardFrom, setForwardFrom] = useState(
    forwardAllocationSection?.suggestedDateRange.from ?? '',
  );
  const [forwardTo, setForwardTo] = useState(forwardAllocationSection?.suggestedDateRange.to ?? '');
  const min = rangeConfig?.bounds?.min;
  const max = rangeConfig?.bounds?.max;
  const workloadMax = max;
  const forwardMax = undefined;
  const workloadValid =
    !workloadSection ||
    Boolean(
      workloadFrom &&
        workloadTo &&
        workloadFrom <= workloadTo &&
        (!min || workloadFrom >= min) &&
        (!workloadMax || workloadTo <= workloadMax),
    );
  const forwardValid =
    !forwardAllocationSection ||
    Boolean(forwardFrom && forwardTo && forwardFrom <= forwardTo && (!min || forwardFrom >= min));
  const canSubmit = workloadValid && forwardValid;

  return (
    <div className="space-y-3 rounded-md border border-hairline bg-surface-1 p-3">
      {rangeConfig?.sections.length ? (
        <div className="space-y-2">
          {rangeConfig.sections.map((section) => (
            <div
              key={section.kind}
              className="rounded-md border border-hairline bg-canvas px-3 py-2"
            >
              <p className="font-medium text-ink">{section.title}</p>
              <p className="text-body-sm text-ink-subtle">{section.description}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${section.kind}-report-from-${stepNo}`}>From</Label>
                  <Input
                    id={`${section.kind}-report-from-${stepNo}`}
                    type="date"
                    min={min}
                    max={section.kind === 'workload' ? workloadMax : forwardMax}
                    value={section.kind === 'workload' ? workloadFrom : forwardFrom}
                    onChange={(event) =>
                      section.kind === 'workload'
                        ? setWorkloadFrom(event.target.value)
                        : setForwardFrom(event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${section.kind}-report-to-${stepNo}`}>To</Label>
                  <Input
                    id={`${section.kind}-report-to-${stepNo}`}
                    type="date"
                    min={min}
                    max={section.kind === 'workload' ? workloadMax : forwardMax}
                    value={section.kind === 'workload' ? workloadTo : forwardTo}
                    onChange={(event) =>
                      section.kind === 'workload'
                        ? setWorkloadTo(event.target.value)
                        : setForwardTo(event.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-hairline pt-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={rejectReportRange}
          disabled={isSubmittingReportDecision}
        >
          Skip report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() =>
            confirmReportRange(
              {
                ...(workloadSection
                  ? { workloadDateRange: { from: workloadFrom, to: workloadTo } }
                  : {}),
                ...(forwardAllocationSection
                  ? { forwardAllocationDateRange: { from: forwardFrom, to: forwardTo } }
                  : {}),
              },
              'manual_database',
            )
          }
          disabled={!canSubmit || isSubmittingReportDecision}
        >
          {isSubmittingReportDecision ? 'Generating...' : 'Generate report'}
        </Button>
        {rangeConfig?.source === 'sheet_or_database' ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() =>
              confirmReportRange(
                {
                  ...(workloadSection
                    ? {
                        workloadDateRange: {
                          from: workloadSection.suggestedDateRange.from,
                          to: workloadSection.suggestedDateRange.to,
                        },
                      }
                    : {}),
                  ...(forwardAllocationSection
                    ? {
                        forwardAllocationDateRange: {
                          from: forwardAllocationSection.suggestedDateRange.from,
                          to: forwardAllocationSection.suggestedDateRange.to,
                        },
                      }
                    : {}),
                },
                'sheet_derived',
              )
            }
            disabled={isSubmittingReportDecision}
          >
            Use suggested ranges
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PmoReportRunStatus(props: { reportRunId: string }) {
  const report = usePmoReport(props.reportRunId);
  const retry = useRetryPmoReport();

  if (report.isLoading || !report.data) {
    return (
      <p className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-ink-subtle">
        Loading report status...
      </p>
    );
  }

  return (
    <ReportStatusCard
      report={report.data}
      isRetrying={retry.isPending}
      onRetry={() =>
        retry.mutate(props.reportRunId, {
          onError: (error) => toast.error('Retry failed', { description: error.message }),
        })
      }
    />
  );
}

export function PmoReportReviewPanel(props: {
  step: ExecutionCard;
  selectedReportApproval: WorkflowApprovalRow | null;
  reportApprovalsCount: number;
  isSubmittingReportDecision: boolean;
  confirmReportRange: (
    ranges: {
      workloadDateRange?: { from: string; to: string };
      forwardAllocationDateRange?: { from: string; to: string };
    },
    strategy?: 'sheet_derived' | 'manual_database',
  ) => void;
  rejectReportRange: () => void;
}) {
  const {
    step,
    selectedReportApproval,
    reportApprovalsCount,
    isSubmittingReportDecision,
    confirmReportRange,
    rejectReportRange,
  } = props;
  const rangeConfig = useMemo(
    () => readReportRangeConfigFromApproval(selectedReportApproval),
    [selectedReportApproval],
  );
  const outputEntries = Object.entries(step.output_summary ?? {});
  const reportRunIds = [
    ...(typeof step.output_summary?.workload_report_run_id === 'string'
      ? [step.output_summary.workload_report_run_id]
      : []),
    ...(typeof step.output_summary?.forward_allocation_report_run_id === 'string'
      ? [step.output_summary.forward_allocation_report_run_id]
      : []),
    ...(typeof step.output_summary?.report_run_id === 'string'
      ? [step.output_summary.report_run_id]
      : []),
  ].filter((value, index, values) => values.indexOf(value) === index);

  return (
    <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">PMO report</p>
        <span
          className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
        >
          {workflowStepTone(step.status).label}
        </span>
        {reportApprovalsCount > 0 ? (
          <span className="rounded-full bg-primary-tint px-2 py-0.5 text-caption font-medium text-primary-ink">
            {reportApprovalsCount} pending
          </span>
        ) : null}
      </div>

      {reportRunIds.length > 0 ? (
        <div className="space-y-2">
          {reportRunIds.map((reportRunId) => (
            <PmoReportRunStatus key={reportRunId} reportRunId={reportRunId} />
          ))}
        </div>
      ) : selectedReportApproval?.status === 'pending' ? (
        <PmoReportRangeForm
          key={`${selectedReportApproval.approvalId}-${rangeConfig?.sections.map((section) => `${section.kind}:${section.suggestedDateRange.from}:${section.suggestedDateRange.to}`).join('|') ?? ''}`}
          stepNo={step.step_no}
          rangeConfig={rangeConfig}
          isSubmittingReportDecision={isSubmittingReportDecision}
          confirmReportRange={confirmReportRange}
          rejectReportRange={rejectReportRange}
        />
      ) : outputEntries.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {outputEntries.map(([key, value]) => (
            <div key={key} className="rounded-md border border-hairline bg-surface-1 px-2 py-1.5">
              <dt className="text-caption uppercase text-ink-subtle">{key.replaceAll('_', ' ')}</dt>
              <dd className="mt-0.5 font-mono text-body-sm text-ink">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-ink-subtle">
          The report will run after publish once the date range is confirmed.
        </p>
      )}
    </div>
  );
}

function StepOutputSummary(props: { summary: Record<string, unknown> }) {
  const entries = Object.entries(props.summary);
  if (entries.length === 0) return null;

  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-hairline bg-surface-1 px-2 py-1.5">
          <dt className="text-caption uppercase text-ink-subtle">{key.replaceAll('_', ' ')}</dt>
          <dd className="mt-0.5 font-mono text-body-sm text-ink">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function groupMappingItems(items: MappingProgressItem[]): GroupedMappingItemsBySheet[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const sheetCompare = (a.sourceSheet ?? '').localeCompare(b.sourceSheet ?? '');
    if (sheetCompare !== 0) return sheetCompare;
    const tableCompare = a.table.localeCompare(b.table);
    if (tableCompare !== 0) return tableCompare;
    return a.field.localeCompare(b.field);
  });

  const groups: GroupedMappingItemsBySheet[] = [];
  for (const item of sorted) {
    const sheetName = item.sourceSheet ?? 'Unknown sheet';
    const last = groups[groups.length - 1];
    if (!last || last.sheetName !== sheetName) {
      groups.push({ sheetName, items: [item] });
      continue;
    }
    last.items.push(item);
  }

  return groups;
}

export function PmoExecutionStepCard(props: PmoExecutionStepCardProps) {
  const {
    selectedSession,
    step,
    readOnly: forceReadOnly,
    runtime,
    mapping,
    normalization,
    publish,
    report,
    profiling,
    plan: planContext,
    submitClarification,
  } = props;

  const {
    executionCurrentStepNo,
    executionCurrentStepStatus,
    firstExecutionStepNo,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  } = runtime;

  const {
    selectedMappingApproval,
    mappingApprovalsCount,
    groupedMappingItems,
    selectedMappingView,
    editingMappingKey,
    selectedMappingAlternate,
    editingMappingItem,
    editingMappingAlternates,
    selectedAlternateOption,
    canProceedToNextStep,
    isSubmittingDecision,
    approveCurrentMappingItem,
    openMappingModify,
    applyMappingModify,
    proceedToNextWorkflowStep,
    selectMappingAlternate,
    cancelMappingModify,
  } = mapping;

  const {
    selectedNormalizationApproval,
    normalizationApprovalsCount,
    selectedNormalizationView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  } = normalization;

  const {
    selectedPublishApproval,
    publishApprovalsCount,
    selectedPublishView,
    isSubmittingPublishDecision,
    approvePublish,
    rejectPublish,
  } = publish;

  const {
    selectedReportApproval,
    reportApprovalsCount,
    isSubmittingReportDecision,
    confirmReportRange,
    rejectReportRange,
  } = report;

  const {
    profilingReviewState,
    profilingSummary,
    profilingDocuments,
    selectedSessionOverrides,
    profilingAreas,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    dropzoneAccept,
    dropzoneMaxBytes,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    onSelectSheetArea,
    onToggleSheetIgnore,
  } = profiling;

  const { plan, goalDraft } = planContext;

  const tone = workflowStepTone(step.status);
  const isCurrentByExecutionState =
    step.step_no === (executionCurrentStepNo ?? firstExecutionStepNo) &&
    executionCurrentStepStatus !== 'cancelled';
  const useRuntimeCurrentStep = Boolean(runtimeActiveStepId) && hasRuntimeCurrentStepMatch;
  const isCurrent =
    executionCurrentStepStatus !== 'cancelled' &&
    (useRuntimeCurrentStep && runtimeActiveStepId
      ? executionStepMatchesRuntimeStep(step, runtimeActiveStepId)
      : isCurrentByExecutionState);

  const isWorkbookProfilingStep =
    step.action_id === 'workbook_profiling' ||
    step.review_type === 'profiling' ||
    /workbook\s*profil/i.test(step.step_name);
  const isLikelyMappingStep =
    step.action_id === 'column_mapping' ||
    step.review_type === 'mapping' ||
    /column\s*mapping|mapping\s*proposal|confirm\s*mapping/i.test(step.step_name);
  const isLikelyPublishStep =
    step.action_id === 'publish_after_approval' ||
    step.action_id === 'database_change_summary' ||
    step.review_type === 'publish' ||
    /publish|final\s*approval|database\s*change|database\s*comparison|change\s*summary|review\s*changes/i.test(
      step.step_name,
    );
  const isLikelyNormalizationStep =
    step.action_id === 'normalize_to_staging' ||
    step.review_type === 'normalization' ||
    /normaliz|staging|validate|validation|data\s*quality|duplicate|anomal/i.test(step.step_name);
  const isLikelyReportStep =
    step.action_id === 'generate_report' ||
    step.review_type === 'report' ||
    /report|utili[sz]ation|overbook|idle/i.test(step.step_name);
  const isPlanApprovalStep = /plan\s*approval|approve\s*plan/i.test(step.step_name);
  const shouldRenderProfilingDetails = isWorkbookProfilingStep;
  const stepActionApproval = step.action_id
    ? (runtime.approvalByActionId[step.action_id as PmoPlanActionId] ?? null)
    : null;
  const selectedMappingApprovalForStep =
    isLikelyMappingStep && stepActionApproval ? stepActionApproval : selectedMappingApproval;
  const selectedMappingViewForStep =
    isLikelyMappingStep && stepActionApproval
      ? parseMappingView(stepActionApproval)
      : selectedMappingView;
  const groupedMappingItemsForStep =
    selectedMappingViewForStep === selectedMappingView
      ? groupedMappingItems
      : groupMappingItems(selectedMappingViewForStep?.items ?? []);
  const selectedNormalizationApprovalForStep =
    isLikelyNormalizationStep && stepActionApproval
      ? stepActionApproval
      : selectedNormalizationApproval;
  const selectedNormalizationViewForStep =
    isLikelyNormalizationStep && stepActionApproval
      ? parseNormalizationReviewView(stepActionApproval)
      : selectedNormalizationView;
  const selectedPublishApprovalForStep =
    isLikelyPublishStep && stepActionApproval ? stepActionApproval : selectedPublishApproval;
  const selectedPublishViewForStep =
    isLikelyPublishStep && stepActionApproval
      ? parsePublishReviewView(stepActionApproval)
      : selectedPublishView;
  const selectedReportApprovalForStep =
    isLikelyReportStep && stepActionApproval ? stepActionApproval : selectedReportApproval;

  // Render mapping/normalization/publish panels when:
  // 1. The step is the current actionable step (pending approval), OR
  // 2. The step has a decided approval (historical read-only view).
  const isMappingReadOnly =
    forceReadOnly ||
    Boolean(
      selectedMappingApprovalForStep?.status && selectedMappingApprovalForStep.status !== 'pending',
    ) ||
    (!isCurrent && Boolean(selectedMappingApprovalForStep));
  const shouldRenderMappingDetails =
    isLikelyMappingStep && (isCurrent || Boolean(selectedMappingApprovalForStep));
  const isNormalizationReadOnly =
    forceReadOnly ||
    Boolean(
      selectedNormalizationApprovalForStep?.status &&
        selectedNormalizationApprovalForStep.status !== 'pending',
    ) ||
    (!isCurrent && Boolean(selectedNormalizationApprovalForStep));
  const shouldRenderNormalizationDetails =
    isLikelyNormalizationStep &&
    (isCurrent || Boolean(selectedNormalizationApprovalForStep) || Boolean(step.output_summary));
  const isPublishReadOnly =
    forceReadOnly ||
    Boolean(
      selectedPublishApprovalForStep?.status && selectedPublishApprovalForStep.status !== 'pending',
    ) ||
    (!isCurrent && Boolean(selectedPublishApprovalForStep));
  const shouldRenderPublishDetails =
    isLikelyPublishStep && (isCurrent || Boolean(selectedPublishApprovalForStep));
  const hasOpenProfilingReview =
    isWorkbookProfilingStep &&
    selectedSession.planning_state === 'approved_plan' &&
    profilingReviewState?.status === 'needs_review';
  const isProfilingPanelCurrent = !forceReadOnly && (isCurrent || hasOpenProfilingReview);
  const isProfilingStepReadOnly =
    forceReadOnly || (isWorkbookProfilingStep && !isProfilingPanelCurrent);
  const isApprovedReadOnly = isProfilingStepReadOnly && profilingReviewState?.status === 'approved';

  // Agent note and clarification rendering is handled by CardClarificationPanel
  // which reads directly from the approval's proposedPayload.

  return (
    <li className="rounded-lg border border-hairline bg-surface-1 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            Step {step.step_no}: {step.step_name}
          </p>
          {step.description ? <p className="mt-0.5 text-ink-subtle">{step.description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isCurrent ? (
            <span className="rounded-full bg-primary-tint px-2 py-0.5 text-caption font-medium text-primary-ink">
              Active
            </span>
          ) : null}
          <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${tone.badge}`}>
            {tone.label}
          </span>
        </div>
      </div>

      {shouldRenderProfilingDetails ? (
        <PmoProfilingDetailsPanel
          stepStatus={step.status}
          isCurrent={isProfilingPanelCurrent}
          isProfilingStepReadOnly={isProfilingStepReadOnly}
          isApprovedReadOnly={isApprovedReadOnly}
          profilingReviewState={profilingReviewState}
          profilingSummary={profilingSummary}
          profilingDocuments={profilingDocuments}
          profilingApproval={stepActionApproval}
          selectedSessionOverrides={selectedSessionOverrides}
          profilingAreas={profilingAreas}
          isAppendingDocument={isAppendingDocument}
          isSavingProfilingReview={isSavingProfilingReview}
          isApprovingProfiling={isApprovingProfiling}
          canShowProfilingActions={selectedSession.planning_state === 'approved_plan'}
          dropzoneAccept={dropzoneAccept}
          dropzoneMaxBytes={dropzoneMaxBytes}
          handleAppendDocument={handleAppendDocument}
          handleSaveProfilingReview={handleSaveProfilingReview}
          handleApproveProfilingContinue={handleApproveProfilingContinue}
          onSelectSheetArea={onSelectSheetArea}
          onToggleSheetIgnore={onToggleSheetIgnore}
        />
      ) : shouldRenderMappingDetails ? (
        <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Column mapping proposal</p>
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
            >
              {workflowStepTone(step.status).label}
            </span>
          </div>

          <CardClarificationPanel
            approval={selectedMappingApprovalForStep}
            isCurrent={isCurrent}
            onClarify={
              submitClarification && selectedMappingApprovalForStep
                ? (msg) => submitClarification(selectedMappingApprovalForStep.approvalId, msg)
                : undefined
            }
          />
          <PmoMappingReviewPanel
            readOnly={isMappingReadOnly}
            selectedMappingApproval={selectedMappingApprovalForStep}
            mappingApprovalsCount={mappingApprovalsCount}
            groupedMappingItems={groupedMappingItemsForStep}
            selectedMappingView={selectedMappingViewForStep}
            editingMappingKey={editingMappingKey}
            selectedMappingAlternate={selectedMappingAlternate}
            editingMappingItem={editingMappingItem}
            editingMappingAlternates={editingMappingAlternates}
            selectedAlternateOption={selectedAlternateOption}
            canProceedToNextStep={canProceedToNextStep}
            isSubmittingDecision={isSubmittingDecision}
            approveCurrentMappingItem={approveCurrentMappingItem}
            openMappingModify={openMappingModify}
            applyMappingModify={applyMappingModify}
            proceedToNextWorkflowStep={proceedToNextWorkflowStep}
            selectMappingAlternate={selectMappingAlternate}
            cancelMappingModify={cancelMappingModify}
          />
        </div>
      ) : shouldRenderNormalizationDetails ? (
        <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Normalization validation</p>
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
            >
              {workflowStepTone(step.status).label}
            </span>
          </div>

          <CardClarificationPanel
            approval={selectedNormalizationApprovalForStep}
            isCurrent={isCurrent}
            onClarify={
              submitClarification && selectedNormalizationApprovalForStep
                ? (msg) => submitClarification(selectedNormalizationApprovalForStep.approvalId, msg)
                : undefined
            }
          />
          {selectedNormalizationApprovalForStep ? (
            <PmoNormalizationReviewPanel
              readOnly={isNormalizationReadOnly}
              selectedNormalizationApproval={selectedNormalizationApprovalForStep}
              normalizationApprovalsCount={normalizationApprovalsCount}
              selectedNormalizationView={selectedNormalizationViewForStep}
              memberAdditionDrafts={memberAdditionDrafts}
              canApproveNormalization={canApproveNormalization}
              isSubmittingNormalizationDecision={isSubmittingNormalizationDecision}
              updateMemberAdditionDraft={updateMemberAdditionDraft}
              updateNormalizationRowDecision={updateNormalizationRowDecision}
              updateNormalizationRowValue={updateNormalizationRowValue}
              resetNormalizationRowOverrides={resetNormalizationRowOverrides}
              approveNormalization={approveNormalization}
              rejectNormalization={rejectNormalization}
            />
          ) : step.output_summary ? (
            <StepOutputSummary summary={step.output_summary} />
          ) : (
            <PmoNormalizationReviewPanel
              readOnly={isNormalizationReadOnly}
              selectedNormalizationApproval={selectedNormalizationApprovalForStep}
              normalizationApprovalsCount={normalizationApprovalsCount}
              selectedNormalizationView={selectedNormalizationViewForStep}
              memberAdditionDrafts={memberAdditionDrafts}
              canApproveNormalization={canApproveNormalization}
              isSubmittingNormalizationDecision={isSubmittingNormalizationDecision}
              updateMemberAdditionDraft={updateMemberAdditionDraft}
              updateNormalizationRowDecision={updateNormalizationRowDecision}
              updateNormalizationRowValue={updateNormalizationRowValue}
              resetNormalizationRowOverrides={resetNormalizationRowOverrides}
              approveNormalization={approveNormalization}
              rejectNormalization={rejectNormalization}
            />
          )}
        </div>
      ) : shouldRenderPublishDetails ? (
        <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Publish review</p>
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
            >
              {workflowStepTone(step.status).label}
            </span>
          </div>

          <CardClarificationPanel
            approval={selectedPublishApprovalForStep}
            isCurrent={isCurrent}
            onClarify={
              submitClarification && selectedPublishApprovalForStep
                ? (msg) => submitClarification(selectedPublishApprovalForStep.approvalId, msg)
                : undefined
            }
          />
          <PmoPublishReviewPanel
            readOnly={isPublishReadOnly}
            selectedPublishApproval={selectedPublishApprovalForStep}
            publishApprovalsCount={publishApprovalsCount}
            selectedPublishView={selectedPublishViewForStep}
            isSubmittingPublishDecision={isSubmittingPublishDecision}
            approvePublish={approvePublish}
            rejectPublish={rejectPublish}
          />
        </div>
      ) : isLikelyReportStep ? (
        <>
          <CardClarificationPanel
            approval={selectedReportApprovalForStep}
            isCurrent={isCurrent}
            onClarify={
              submitClarification && selectedReportApprovalForStep
                ? (msg) => submitClarification(selectedReportApprovalForStep.approvalId, msg)
                : undefined
            }
          />
          <PmoReportReviewPanel
            step={step}
            selectedReportApproval={selectedReportApprovalForStep}
            reportApprovalsCount={reportApprovalsCount}
            isSubmittingReportDecision={isSubmittingReportDecision}
            confirmReportRange={confirmReportRange}
            rejectReportRange={rejectReportRange}
          />
        </>
      ) : isPlanApprovalStep ? (
        <PmoExecutionPlanSnapshot
          selectedSession={selectedSession}
          plan={plan}
          goalDraft={goalDraft}
        />
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-hairline-strong bg-canvas px-2 py-1.5 text-ink-subtle">
          This step is planned and read-only for now. Implementation will be added in subsequent
          iteration.
        </p>
      )}
    </li>
  );
}
