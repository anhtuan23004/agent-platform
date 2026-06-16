import { Button, Dropzone, Input, Label, PageChrome, Textarea, toast } from '@seta/shared-ui';
import { CheckCircle2, Circle, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowApprovalRow } from '../../agent/workflows/api/schemas.ts';
import { usePendingApprovals } from '../../agent/workflows/hooks/use-pending-approvals.ts';
import { useSubmitDecision } from '../../agent/workflows/hooks/use-submit-decision.ts';
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
  'overbook_idle_config',
  'member_master',
  'project_master',
  'leave',
  'calendar_weeks',
  'kpi_norms',
  'unknown',
];

type TimelineState = 'done' | 'current' | 'pending';

type ExecutionCard = {
  step_no: number;
  step_name: string;
  status: PmoWorkflowExecutionStepStatus;
  description?: string;
};

type ExecutionActionGroup = {
  id: 'needs_action' | 'in_progress' | 'upcoming' | 'completed' | 'cancelled';
  title: string;
  hint: string;
  badgeTone: string;
  steps: ExecutionCard[];
};

interface MappingProgressItem {
  key: string;
  table: string;
  field: string;
  sourceSheet: string | null;
  sourceColumn: string | null;
  confidence: string | null;
  approvedBy: string | null;
  state: 'approved' | 'pending' | 'current';
  issueType: string;
  actionType: 'modify_only' | 'approve_and_modify';
}

interface MappingAlternateOption {
  alternateIndex: number;
  itemKey: string;
  sourceColumn: string;
  confidence: string | null;
  blocked: boolean;
}

interface MappingViewModel {
  approved: number;
  total: number;
  items: MappingProgressItem[];
  current: Map<string, string>;
  currentKey: string | null;
  alternatesByItemKey: Map<string, MappingAlternateOption[]>;
  awaitingNextStep: boolean;
}

function groupExecutionCardsByAction(cards: ExecutionCard[]): ExecutionActionGroup[] {
  const groups: ExecutionActionGroup[] = [
    {
      id: 'needs_action',
      title: 'Needs action',
      hint: 'Review or resolve these steps before continuing.',
      badgeTone: 'bg-warning-tint text-warning-ink',
      steps: [],
    },
    {
      id: 'in_progress',
      title: 'In progress',
      hint: 'These steps are currently running.',
      badgeTone: 'bg-primary-tint text-primary-ink',
      steps: [],
    },
    {
      id: 'upcoming',
      title: 'Upcoming',
      hint: 'Queued steps waiting for upstream completion.',
      badgeTone: 'bg-surface-2 text-ink-subtle',
      steps: [],
    },
    {
      id: 'completed',
      title: 'Completed',
      hint: 'Finished steps kept for traceability.',
      badgeTone: 'bg-success-tint text-success-ink',
      steps: [],
    },
    {
      id: 'cancelled',
      title: 'Cancelled',
      hint: 'Workflow steps cancelled and no longer executable.',
      badgeTone: 'bg-danger-tint text-danger-ink',
      steps: [],
    },
  ];

  for (const card of cards) {
    if (card.status === 'failed' || card.status === 'needs_review') {
      groups[0]?.steps.push(card);
      continue;
    }

    if (card.status === 'in_progress') {
      groups[1]?.steps.push(card);
      continue;
    }

    if (card.status === 'pending') {
      groups[2]?.steps.push(card);
      continue;
    }

    if (card.status === 'cancelled') {
      groups[4]?.steps.push(card);
      continue;
    }

    groups[3]?.steps.push(card);
  }

  return groups.filter((group) => group.steps.length > 0);
}

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

function shortId(value: string): string {
  return value.slice(0, 8);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function splitSheetAndColumn(
  sourceColumn: string,
  fallbackSheetName: string | null,
): { sheetName: string; columnName: string } {
  const trimmed = sourceColumn.trim();
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
    return {
      sheetName: trimmed.slice(0, dotIndex).trim(),
      columnName: trimmed.slice(dotIndex + 1).trim(),
    };
  }

  return {
    sheetName: fallbackSheetName?.trim() || 'sheet_name',
    columnName: trimmed,
  };
}

function mapRows(rows: Array<{ k: string; v: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.k, row.v);
  return out;
}

function parseFraction(
  value: string | null | undefined,
): { approved: number; total: number } | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const approved = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(approved) || !Number.isFinite(total)) return null;
  return { approved, total };
}

function isRenderableApprovalPayload(
  payload: unknown,
): payload is { details: unknown[]; primary: { label: string }; decline?: { label: string } } {
  if (!payload || typeof payload !== 'object') return false;
  const card = payload as {
    details?: unknown;
    primary?: { label?: unknown };
    decline?: { label?: unknown };
  };
  return Array.isArray(card.details) && typeof card.primary?.label === 'string';
}

function kvTablesFromPayload(payload: unknown): Array<Array<{ k: string; v: string }>> {
  if (!isRenderableApprovalPayload(payload)) return [];
  const out: Array<Array<{ k: string; v: string }>> = [];

  for (const detail of payload.details) {
    if (!detail || typeof detail !== 'object') continue;
    if ((detail as { kind?: unknown }).kind !== 'kvTable') continue;

    const rows = (detail as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) continue;

    const kvRows: Array<{ k: string; v: string }> = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const key = (row as { k?: unknown }).k;
      const value = (row as { v?: unknown }).v;
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      kvRows.push({ k: key, v: value });
    }
    out.push(kvRows);
  }

  return out;
}

function cardToolIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const toolId = (meta as { toolId?: unknown }).toolId;
  return typeof toolId === 'string' ? toolId : null;
}

function isMappingApprovalRow(approval: WorkflowApprovalRow): boolean {
  const stepId = approval.stepId;
  if (
    stepId === 'pmo.ingest.confirmMapping' ||
    stepId === 'confirmMapping' ||
    stepId.endsWith('.confirmMapping')
  ) {
    return true;
  }

  return cardToolIdFromPayload(approval.proposedPayload) === 'pmo_confirmMapping';
}

function readIngestionSessionIdFromApproval(approval: WorkflowApprovalRow): string | null {
  const uuidMatch = (value: string): string | null => {
    const match = value.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    return match ? match[0] : null;
  };

  const tables = kvTablesFromPayload(approval.proposedPayload);
  for (const table of tables) {
    for (const row of table) {
      const normalizedKey = row.k.trim().toLowerCase();
      if (
        normalizedKey !== 'ingestion session' &&
        normalizedKey !== 'ingestion session id' &&
        normalizedKey !== 'session id'
      ) {
        continue;
      }

      const value = row.v.trim();
      if (value.length > 0) return uuidMatch(value) ?? value;
    }
  }

  return null;
}

function sessionIdsMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function parseMappingItems(
  progressRows: Array<{ k: string; v: string }>,
  options?: {
    current?: Map<string, string>;
    currentKey?: string | null;
    currentSourceColumn?: string | null;
    currentConfidence?: string | null;
  },
): MappingProgressItem[] {
  const current = options?.current ?? new Map<string, string>();
  const currentKey = options?.currentKey ?? null;
  const currentSourceColumn = options?.currentSourceColumn ?? null;
  const currentConfidence = options?.currentConfidence ?? null;

  const items: MappingProgressItem[] = [];
  for (const row of progressRows) {
    if (row.k === 'more') continue;
    const dotIndex = row.k.indexOf('.');
    if (dotIndex < 0) continue;

    const table = row.k.slice(0, dotIndex);
    const field = row.k.slice(dotIndex + 1);

    const [
      statePartRaw = '',
      issueTypeRaw = '',
      sourceColumnRaw = '',
      confidenceRaw = '',
      approvedByRaw = '',
      sourceSheetRaw = '',
      actionTypeRaw = '',
    ] = row.v.split('|').map((v) => v.trim());

    if (!issueTypeRaw && !sourceColumnRaw && !confidenceRaw && !approvedByRaw && !sourceSheetRaw) {
      continue;
    }

    const statePart = statePartRaw.toLowerCase();
    const itemKey = `${table}.${field}`;

    let state: 'approved' | 'pending' | 'current' = 'pending';
    if (statePart.startsWith('approved')) state = 'approved';
    else if (statePart.startsWith('current')) state = 'current';

    const sourceColumn = sourceColumnRaw || (itemKey === currentKey ? currentSourceColumn : null);
    const confidence = confidenceRaw || (itemKey === currentKey ? currentConfidence : null);
    const approvedBy = approvedByRaw && approvedByRaw !== '-' ? approvedByRaw : null;
    const sourceSheet = sourceSheetRaw || current.get('Sheet') || null;
    const actionType: MappingProgressItem['actionType'] =
      actionTypeRaw === 'modify_only' || issueTypeRaw === 'auto_accept'
        ? 'modify_only'
        : 'approve_and_modify';

    items.push({
      key: itemKey,
      table,
      field,
      sourceSheet,
      sourceColumn,
      confidence,
      approvedBy,
      state,
      issueType: issueTypeRaw,
      actionType,
    });
  }

  return items;
}

function parseMappingViewPayload(payload: unknown): MappingViewModel | null {
  const tables = kvTablesFromPayload(payload);
  if (tables.length === 0) return null;

  const awaitingNextStep = (() => {
    if (!payload || typeof payload !== 'object') return false;
    const primary = (payload as { primary?: unknown }).primary;
    if (!primary || typeof primary !== 'object') return false;
    const argsPatch = (primary as { argsPatch?: unknown }).argsPatch;
    if (!argsPatch || typeof argsPatch !== 'object') return false;
    return (argsPatch as { proceedToNextStep?: unknown }).proceedToNextStep === true;
  })();

  const summary = mapRows(tables[0] ?? []);
  const current = mapRows(tables[1] ?? []);
  const progressRows = tables[tables.length - 1] ?? [];
  const currentTable = current.get('Table') ?? null;
  const currentField = current.get('Field') ?? null;
  const currentKey =
    awaitingNextStep || !currentTable || !currentField ? null : `${currentTable}.${currentField}`;
  const currentSourceColumn = current.get('Source column') ?? null;
  const currentConfidence = current.get('Confidence') ?? null;
  const alternatesByItemKey = new Map<string, MappingAlternateOption[]>();

  if (isRenderableApprovalPayload(payload)) {
    const alternates = (payload as { alternates?: unknown }).alternates;
    if (Array.isArray(alternates)) {
      alternates.forEach((alternate, index) => {
        if (!alternate || typeof alternate !== 'object') return;
        const argsPatch = (alternate as { argsPatch?: unknown }).argsPatch;
        if (!argsPatch || typeof argsPatch !== 'object') return;

        const mappingOverride = (argsPatch as { mappingOverride?: unknown }).mappingOverride;
        if (!mappingOverride || typeof mappingOverride !== 'object') return;

        const tableId = (mappingOverride as { tableId?: unknown }).tableId;
        const field = (mappingOverride as { field?: unknown }).field;
        const sourceColumn = (mappingOverride as { sourceColumn?: unknown }).sourceColumn;
        if (typeof tableId !== 'string' || typeof field !== 'string') return;
        if (typeof sourceColumn !== 'string' || sourceColumn.length === 0) return;

        const itemKey = `${tableId}.${field}`;
        const rawConfidence = (mappingOverride as { confidence?: unknown }).confidence;
        const confidence = typeof rawConfidence === 'number' ? formatPercent(rawConfidence) : null;
        const blocked =
          (mappingOverride as { blocked?: unknown }).blocked === true ||
          (mappingOverride as { blocked?: unknown }).blocked === 'true';

        const entry = alternatesByItemKey.get(itemKey) ?? [];
        entry.push({
          alternateIndex: index,
          itemKey,
          sourceColumn,
          confidence,
          blocked,
        });
        alternatesByItemKey.set(itemKey, entry);
      });
    }
  }

  const items = parseMappingItems(progressRows, {
    current,
    currentKey,
    currentSourceColumn,
    currentConfidence,
  });

  const fraction = parseFraction(summary.get('Approved items'));
  const approved = fraction?.approved ?? items.filter((item) => item.state === 'approved').length;
  const total = fraction?.total ?? items.length;

  return {
    approved,
    total,
    items,
    current,
    currentKey,
    alternatesByItemKey,
    awaitingNextStep,
  };
}

function parseMappingView(approval: WorkflowApprovalRow | null): MappingViewModel | null {
  if (!approval) return null;
  return parseMappingViewPayload(approval.proposedPayload);
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
  if (statusLabel === 'Cancelled') {
    return 'bg-danger-tint text-danger-ink';
  }

  if (statusLabel === 'Execution completed') {
    return 'bg-success-tint text-success-ink';
  }

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

  if (status === 'cancelled') {
    return {
      circle: 'border-danger bg-danger text-white',
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

  if (status === 'cancelled') {
    return {
      badge: 'bg-danger-tint text-danger-ink',
      label: 'Cancelled',
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

function buildExecutionCards(session: PmoPlanningSession | null): ExecutionCard[] {
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
  const [isCancellingWorkflowBySessionId, setIsCancellingWorkflowBySessionId] = useState<
    Record<string, boolean>
  >({});
  const [editingMappingKey, setEditingMappingKey] = useState<string | null>(null);
  const [selectedMappingAlternate, setSelectedMappingAlternate] = useState<number | null>(null);

  const pendingApprovals = usePendingApprovals();
  const submitDecision = useSubmitDecision();
  const [profilingOverridesBySessionId, setProfilingOverridesBySessionId] = useState<
    Record<string, Record<string, { finalArea: PmoProfilingArea; markIgnore: boolean }>>
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

  const mappingApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isMappingApprovalRow(approval)),
    [pendingApprovals.data],
  );

  const selectedMappingApproval = useMemo(() => {
    if (!selectedSession) return null;

    const exactMatch = mappingApprovals.find((approval) => {
      const ingestionSessionId = readIngestionSessionIdFromApproval(approval);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (exactMatch) return exactMatch;

    // Fallback for cards that do not carry a parseable session id.
    if (mappingApprovals.length === 1) {
      return mappingApprovals[0] ?? null;
    }

    return null;
  }, [mappingApprovals, selectedSession]);

  const selectedMappingView = useMemo(
    () => parseMappingView(selectedMappingApproval),
    [selectedMappingApproval],
  );

  const groupedMappingItems = useMemo(() => {
    if (!selectedMappingView?.items.length)
      return [] as Array<{
        sheetName: string;
        items: MappingProgressItem[];
      }>;

    const sorted = [...selectedMappingView.items].sort((a, b) => {
      const sheetCompare = (a.sourceSheet ?? '').localeCompare(b.sourceSheet ?? '');
      if (sheetCompare !== 0) return sheetCompare;
      const tableCompare = a.table.localeCompare(b.table);
      if (tableCompare !== 0) return tableCompare;
      return a.field.localeCompare(b.field);
    });

    const groups: Array<{ sheetName: string; items: MappingProgressItem[] }> = [];
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
  }, [selectedMappingView?.items]);

  const editingMappingItem = useMemo(
    () => selectedMappingView?.items.find((item) => item.key === editingMappingKey) ?? null,
    [selectedMappingView?.items, editingMappingKey],
  );

  const editingMappingAlternates = useMemo(() => {
    if (!selectedMappingView || !editingMappingKey) return [] as MappingAlternateOption[];
    return selectedMappingView.alternatesByItemKey.get(editingMappingKey) ?? [];
  }, [selectedMappingView, editingMappingKey]);

  const selectedAlternateOption = useMemo(
    () =>
      editingMappingAlternates.find(
        (option) => option.alternateIndex === selectedMappingAlternate,
      ) ?? null,
    [editingMappingAlternates, selectedMappingAlternate],
  );

  const mappingEditorScope = `${selectedSessionId ?? ''}:${selectedMappingApproval?.approvalId ?? ''}`;
  const previousMappingEditorScope = useRef(mappingEditorScope);

  const canProceedToNextStep =
    Boolean(selectedMappingApproval) &&
    selectedMappingView?.awaitingNextStep === true &&
    !submitDecision.isPending;

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

  const executionActionGroups = useMemo(
    () => groupExecutionCardsByAction(executionCards),
    [executionCards],
  );

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

  useEffect(() => {
    if (previousMappingEditorScope.current === mappingEditorScope) {
      return;
    }

    previousMappingEditorScope.current = mappingEditorScope;
    setEditingMappingKey(null);
    setSelectedMappingAlternate(null);
  }, [mappingEditorScope]);

  function refreshMappingApprovals() {
    void pendingApprovals.refetch();
  }

  function approveCurrentMappingItem() {
    if (!selectedMappingApproval) return;
    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'approve',
      },
      {
        onSuccess: async () => {
          toast.success('Mapping item approved', {
            description: 'The next mapping item is now ready for review.',
          });
          refreshMappingApprovals();
          await loadSessions(true);
        },
        onError: (err) => {
          toast.error('Failed to approve mapping item', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  function openMappingModify(itemKey: string) {
    if (!selectedMappingView) return;
    const alternatesForItem = selectedMappingView.alternatesByItemKey.get(itemKey) ?? [];
    if (alternatesForItem.length === 0) return;

    setEditingMappingKey(itemKey);
    setSelectedMappingAlternate(alternatesForItem[0]?.alternateIndex ?? null);
  }

  function applyMappingModify() {
    if (!selectedMappingApproval) return;
    if (selectedMappingAlternate === null) return;

    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'modify',
        alternateIndices: [selectedMappingAlternate],
      },
      {
        onSuccess: async () => {
          toast.success('Mapping updated', {
            description: 'The selected source column has been applied for this review item.',
          });
          setEditingMappingKey(null);
          setSelectedMappingAlternate(null);
          refreshMappingApprovals();
          await loadSessions(true);
        },
        onError: (err) => {
          toast.error('Failed to update mapping', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  function proceedToNextWorkflowStep() {
    if (!selectedMappingApproval) return;
    if (selectedMappingView?.awaitingNextStep !== true) return;

    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'approve',
      },
      {
        onSuccess: async () => {
          toast.success('Moved to next step', {
            description: 'Workflow moved to the next step in final plan.',
          });
          refreshMappingApprovals();
          await loadSessions(true);
        },
        onError: (err) => {
          toast.error('Failed to proceed to next step', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

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

    setIsSavingProfilingReview(true);
    try {
      await pmoApi.updateProfilingReview({
        ingestion_session_id: selectedSession.ingestion_session_id,
        sheet_overrides: overridesPayload,
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

  function isWorkflowCancelable(run: PmoPlanningSession): boolean {
    return (
      run.workflow_step_status === 'in_progress' || run.workflow_step_status === 'needs_review'
    );
  }

  async function handleCancelWorkflow(run: PmoPlanningSession) {
    if (!isWorkflowCancelable(run)) {
      toast.error('Cannot cancel workflow', {
        description: 'Cancel is available only while the workflow is running.',
      });
      return;
    }

    if (isCancellingWorkflowBySessionId[run.ingestion_session_id]) {
      return;
    }

    setIsCancellingWorkflowBySessionId((prev) => ({
      ...prev,
      [run.ingestion_session_id]: true,
    }));

    try {
      await pmoApi.cancelWorkflow(run.ingestion_session_id);
      await loadSessions(true);
      toast.success('Workflow cancelled', {
        description: 'The running workflow has been cancelled successfully.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel workflow.';
      toast.error('Cancel failed', { description: message });
    } finally {
      setIsCancellingWorkflowBySessionId((prev) => ({
        ...prev,
        [run.ingestion_session_id]: false,
      }));
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
                      <th className="px-2 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((run, index) => {
                      const selected =
                        run.ingestion_session_id === selectedSession?.ingestion_session_id;
                      const canCancel = isWorkflowCancelable(run);
                      const isCancelling =
                        isCancellingWorkflowBySessionId[run.ingestion_session_id] ?? false;

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
                            <div className="flex items-center gap-2">
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
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={!canCancel || isCancelling}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleCancelWorkflow(run);
                                }}
                              >
                                {isCancelling ? (
                                  <>
                                    <Loader2 className="size-4 animate-spin" />
                                    Cancelling...
                                  </>
                                ) : (
                                  'Cancel'
                                )}
                              </Button>
                            </div>
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
              <div className="space-y-3">
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

                  {selectedSession.planning_state !== 'approved_plan' &&
                  proposedWorkflowSteps.length > 0 ? (
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
                        disabled={
                          isGenerating || selectedSession.planning_state === 'approved_plan'
                        }
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

                {executionCards.length > 0 ? (
                  <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-caption text-ink-subtle">
                    <p className="font-medium text-ink">Workflow execution</p>
                    <p className="mt-1">
                      Step cards are separated from plan details, grouped by action, and listed one
                      row per card.
                    </p>

                    <div className="mt-3 space-y-3">
                      {executionActionGroups.map((group) => (
                        <section
                          key={`${selectedSession.ingestion_session_id}-execution-group-${group.id}`}
                          className="rounded-lg border border-hairline bg-canvas px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-medium text-ink">{group.title}</p>
                              <p className="text-ink-subtle">{group.hint}</p>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-caption font-medium ${group.badgeTone}`}
                            >
                              {group.steps.length} step{group.steps.length === 1 ? '' : 's'}
                            </span>
                          </div>

                          <ol className="mt-2 space-y-2">
                            {group.steps.map((step) => {
                              const tone = workflowStepTone(step.status);
                              const isCurrent =
                                step.step_no ===
                                  (executionState?.current_step_no ?? executionCards[0]?.step_no) &&
                                executionState?.current_step_status !== 'cancelled';
                              const isWorkbookProfilingStep = /workbook\s*profil/i.test(
                                step.step_name,
                              );
                              const isColumnMappingStep =
                                step.step_no === 3 ||
                                /column\s*mapping\s*proposal/i.test(step.step_name);
                              const isPlanApprovalStep = /plan\s*approval|approve\s*plan/i.test(
                                step.step_name,
                              );
                              const shouldRenderProfilingDetails = isWorkbookProfilingStep;
                              const isProfilingStepReadOnly = isWorkbookProfilingStep && !isCurrent;
                              const isApprovedReadOnly =
                                isProfilingStepReadOnly &&
                                profilingReviewState?.status === 'approved';

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

                                  {shouldRenderProfilingDetails ? (
                                    <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-ink">
                                          Workbook Profiling details
                                        </p>
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
                                        {isProfilingStepReadOnly ? (
                                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-subtle">
                                            View only
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
                                          <p className="text-ink-subtle">
                                            No document records yet.
                                          </p>
                                        ) : (
                                          <ul className="space-y-1.5">
                                            {profilingDocuments.map((doc) => {
                                              const docTone = documentStatusTone(doc.status);
                                              const sheetCount =
                                                doc.profile_result?.workbook_summary.sheet_count ??
                                                0;
                                              const rowCount =
                                                doc.profile_result?.workbook_summary.total_rows ??
                                                0;

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
                                                  <div
                                                    className={`mt-1 grid gap-1 sm:grid-cols-3 ${
                                                      isApprovedReadOnly
                                                        ? 'text-ink-subtle'
                                                        : 'text-ink'
                                                    }`}
                                                  >
                                                    <p>
                                                      Uploaded: {formatLocalDate(doc.uploaded_at)}
                                                    </p>
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
                                                            <th className="px-1.5 py-1">
                                                              Confidence
                                                            </th>
                                                            <th className="px-1.5 py-1">Action</th>
                                                            <th className="px-1.5 py-1">
                                                              Override
                                                            </th>
                                                          </tr>
                                                        </thead>
                                                        <tbody>
                                                          {doc.profile_result.sheets.map(
                                                            (sheet) => {
                                                              const key = profilingSheetKey(
                                                                doc.document_id,
                                                                sheet.sheet_name,
                                                              );
                                                              const override =
                                                                selectedSessionOverrides[key];
                                                              const effectiveArea =
                                                                override?.markIgnore
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
                                                                  <td
                                                                    className={`px-1.5 py-1 ${
                                                                      isApprovedReadOnly
                                                                        ? 'text-ink-subtle'
                                                                        : 'text-ink'
                                                                    }`}
                                                                  >
                                                                    {sheet.likely_purpose}
                                                                  </td>
                                                                  <td
                                                                    className={`px-1.5 py-1 ${
                                                                      isApprovedReadOnly
                                                                        ? 'text-ink-subtle'
                                                                        : 'text-ink'
                                                                    }`}
                                                                  >
                                                                    {sheet.final_decision
                                                                      ?.confidence ??
                                                                      (sheet.confidence >= 0.8
                                                                        ? 'high'
                                                                        : sheet.confidence >= 0.55
                                                                          ? 'medium'
                                                                          : 'low')}
                                                                  </td>
                                                                  <td
                                                                    className={`px-1.5 py-1 ${
                                                                      isApprovedReadOnly
                                                                        ? 'text-ink-subtle'
                                                                        : 'text-ink'
                                                                    }`}
                                                                  >
                                                                    {sheet.llm_interpretation
                                                                      ?.recommended_action ??
                                                                      'review'}
                                                                  </td>
                                                                  <td className="px-1.5 py-1">
                                                                    <div className="flex flex-wrap items-center gap-1">
                                                                      <select
                                                                        className="rounded border border-hairline bg-canvas px-1 py-0.5 text-caption disabled:cursor-not-allowed disabled:opacity-70"
                                                                        value={effectiveArea}
                                                                        disabled={
                                                                          isProfilingStepReadOnly
                                                                        }
                                                                        onChange={(event) => {
                                                                          const selectedArea = event
                                                                            .target
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
                                                                                    finalArea:
                                                                                      selectedArea,
                                                                                    markIgnore:
                                                                                      selectedArea ===
                                                                                      'unknown',
                                                                                  },
                                                                                },
                                                                            }),
                                                                          );
                                                                        }}
                                                                      >
                                                                        {PROFILING_AREAS.map(
                                                                          (area) => (
                                                                            <option
                                                                              key={area}
                                                                              value={area}
                                                                            >
                                                                              {area}
                                                                            </option>
                                                                          ),
                                                                        )}
                                                                      </select>
                                                                      <label className="inline-flex items-center gap-1 text-caption text-ink-subtle">
                                                                        <input
                                                                          type="checkbox"
                                                                          checked={Boolean(
                                                                            override?.markIgnore,
                                                                          )}
                                                                          disabled={
                                                                            isProfilingStepReadOnly
                                                                          }
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
                                                                                      finalArea:
                                                                                        checked
                                                                                          ? 'unknown'
                                                                                          : (override?.finalArea ??
                                                                                            sheet
                                                                                              .final_decision
                                                                                              ?.area ??
                                                                                            sheet.candidate_business_area),
                                                                                      markIgnore:
                                                                                        checked,
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
                                                            },
                                                          )}
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

                                      {isCurrent &&
                                      selectedSession.planning_state === 'approved_plan' ? (
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
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : isColumnMappingStep && isCurrent ? (
                                    <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-ink">
                                          Step 3: Column mapping proposal
                                        </p>
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
                                        >
                                          {workflowStepTone(step.status).label}
                                        </span>
                                      </div>

                                      {selectedMappingApproval ? (
                                        <>
                                          <div className="rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
                                            Mapping review is required. The workflow proceeds only
                                            after all mapping items are approved and you click Next
                                            step.
                                          </div>

                                          <section className="rounded-lg border border-hairline bg-surface-1 p-3">
                                            <h4 className="text-body-sm font-semibold text-ink">
                                              Review column mappings
                                            </h4>
                                            <p className="mt-1 text-caption text-ink-subtle">
                                              Approve each mapping item individually. The workflow
                                              proceeds only after all mapping items are approved and
                                              you click Next step.
                                            </p>

                                            <div className="mt-3 overflow-x-auto">
                                              <table className="min-w-full text-left text-caption">
                                                <thead className="border-b border-hairline text-ink-subtle">
                                                  <tr>
                                                    <th className="px-2 py-1.5">Source column</th>
                                                    <th className="px-2 py-1.5">
                                                      Target DB column
                                                    </th>
                                                    <th className="px-2 py-1.5">Issue type</th>
                                                    <th className="px-2 py-1.5">Status</th>
                                                    <th className="px-2 py-1.5">Approved by</th>
                                                    <th className="px-2 py-1.5">
                                                      Confidence score
                                                    </th>
                                                    <th className="px-2 py-1.5">Actions</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {groupedMappingItems.length ? (
                                                    groupedMappingItems.map((group) => (
                                                      <Fragment key={group.sheetName}>
                                                        <tr className="border-b border-hairline bg-surface-2/60">
                                                          <td
                                                            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                                                            colSpan={7}
                                                          >
                                                            Sheet: {group.sheetName}
                                                          </td>
                                                        </tr>

                                                        {group.items.map((item) => {
                                                          const alternatesForItem =
                                                            selectedMappingView?.alternatesByItemKey.get(
                                                              item.key,
                                                            ) ?? [];
                                                          const canApprove =
                                                            Boolean(selectedMappingApproval) &&
                                                            item.actionType ===
                                                              'approve_and_modify' &&
                                                            item.state === 'current' &&
                                                            !submitDecision.isPending;
                                                          const canModify =
                                                            Boolean(selectedMappingApproval) &&
                                                            alternatesForItem.length > 0 &&
                                                            !submitDecision.isPending;
                                                          const isEditingItem =
                                                            editingMappingKey === item.key;

                                                          return (
                                                            <Fragment key={item.key}>
                                                              <tr className="border-b border-hairline last:border-b-0">
                                                                <td className="px-2 py-1.5 font-medium text-ink">
                                                                  {item.sourceColumn ?? item.key}
                                                                </td>
                                                                <td className="px-2 py-1.5 text-primary-ink">
                                                                  dim_{item.table}.{item.field}
                                                                </td>
                                                                <td className="px-2 py-1.5 text-ink-subtle">
                                                                  {item.issueType || '-'}
                                                                </td>
                                                                <td className="px-2 py-1.5">
                                                                  {item.state === 'approved' ? (
                                                                    <span className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-ink">
                                                                      Approved
                                                                    </span>
                                                                  ) : (
                                                                    <span className="rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-ink">
                                                                      Pending
                                                                    </span>
                                                                  )}
                                                                </td>
                                                                <td className="px-2 py-1.5 text-ink-subtle">
                                                                  {item.approvedBy
                                                                    ? shortId(item.approvedBy)
                                                                    : '-'}
                                                                </td>
                                                                <td className="px-2 py-1.5 text-ink-subtle">
                                                                  {item.confidence ?? '-'}
                                                                </td>
                                                                <td className="px-2 py-1.5">
                                                                  <div className="flex items-center gap-1.5">
                                                                    {item.actionType ===
                                                                    'approve_and_modify' ? (
                                                                      <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        disabled={!canApprove}
                                                                        onClick={
                                                                          approveCurrentMappingItem
                                                                        }
                                                                      >
                                                                        {submitDecision.isPending &&
                                                                        item.state === 'current'
                                                                          ? 'Approving...'
                                                                          : 'Approve'}
                                                                      </Button>
                                                                    ) : null}
                                                                    <Button
                                                                      size="sm"
                                                                      variant="secondary"
                                                                      type="button"
                                                                      disabled={!canModify}
                                                                      onClick={() =>
                                                                        openMappingModify(item.key)
                                                                      }
                                                                    >
                                                                      Modify
                                                                    </Button>
                                                                  </div>
                                                                </td>
                                                              </tr>

                                                              {isEditingItem ? (
                                                                <tr className="border-b border-hairline bg-canvas/60">
                                                                  <td
                                                                    colSpan={7}
                                                                    className="px-2 py-2"
                                                                  >
                                                                    <div className="rounded-md border border-hairline bg-canvas p-3">
                                                                      <p className="text-caption font-medium text-ink">
                                                                        Modify current mapping
                                                                      </p>
                                                                      <p className="mt-1 text-caption text-ink-subtle">
                                                                        Modify only changes the
                                                                        source column from sheet
                                                                        data. Target DB column stays
                                                                        dim_{item.table}.
                                                                        {item.field}.
                                                                      </p>

                                                                      <div className="mt-2 space-y-2">
                                                                        <p className="text-caption text-ink-subtle">
                                                                          Candidate source mapping
                                                                        </p>

                                                                        <div className="space-y-1.5">
                                                                          {editingMappingAlternates.map(
                                                                            (option) => {
                                                                              const isSelected =
                                                                                selectedMappingAlternate ===
                                                                                option.alternateIndex;
                                                                              const {
                                                                                sheetName,
                                                                                columnName,
                                                                              } =
                                                                                splitSheetAndColumn(
                                                                                  option.sourceColumn,
                                                                                  editingMappingItem?.sourceSheet ??
                                                                                    item.sourceSheet,
                                                                                );

                                                                              return (
                                                                                <button
                                                                                  key={
                                                                                    option.alternateIndex
                                                                                  }
                                                                                  type="button"
                                                                                  className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left transition-colors ${
                                                                                    isSelected
                                                                                      ? 'border-primary bg-primary-tint/40'
                                                                                      : 'border-hairline bg-canvas hover:bg-surface-1'
                                                                                  }`}
                                                                                  onClick={() => {
                                                                                    setSelectedMappingAlternate(
                                                                                      option.alternateIndex,
                                                                                    );
                                                                                  }}
                                                                                  disabled={
                                                                                    submitDecision.isPending
                                                                                  }
                                                                                >
                                                                                  <span className="font-mono text-body-sm">
                                                                                    <span className="text-danger-ink">
                                                                                      {sheetName}
                                                                                    </span>
                                                                                    <span className="text-ink-subtle">
                                                                                      .
                                                                                    </span>
                                                                                    <span className="text-primary-ink">
                                                                                      {columnName}
                                                                                    </span>
                                                                                  </span>

                                                                                  <span className="text-caption text-ink-subtle">
                                                                                    {option.confidence
                                                                                      ? option.confidence
                                                                                      : 'confidence -'}
                                                                                    {option.blocked
                                                                                      ? ' • blocked'
                                                                                      : ''}
                                                                                  </span>
                                                                                </button>
                                                                              );
                                                                            },
                                                                          )}
                                                                        </div>
                                                                      </div>

                                                                      <div className="mt-2 flex flex-wrap items-end gap-2">
                                                                        <Button
                                                                          type="button"
                                                                          size="sm"
                                                                          variant="primary"
                                                                          disabled={
                                                                            selectedMappingAlternate ===
                                                                              null ||
                                                                            submitDecision.isPending
                                                                          }
                                                                          onClick={
                                                                            applyMappingModify
                                                                          }
                                                                        >
                                                                          {submitDecision.isPending
                                                                            ? 'Applying...'
                                                                            : 'Apply change'}
                                                                        </Button>
                                                                        <Button
                                                                          type="button"
                                                                          size="sm"
                                                                          variant="secondary"
                                                                          disabled={
                                                                            submitDecision.isPending
                                                                          }
                                                                          onClick={() => {
                                                                            setEditingMappingKey(
                                                                              null,
                                                                            );
                                                                            setSelectedMappingAlternate(
                                                                              null,
                                                                            );
                                                                          }}
                                                                        >
                                                                          Cancel
                                                                        </Button>
                                                                      </div>

                                                                      {selectedAlternateOption
                                                                        ? (() => {
                                                                            const {
                                                                              sheetName,
                                                                              columnName,
                                                                            } = splitSheetAndColumn(
                                                                              selectedAlternateOption.sourceColumn,
                                                                              editingMappingItem?.sourceSheet ??
                                                                                item.sourceSheet,
                                                                            );

                                                                            return (
                                                                              <p className="mt-2 text-caption text-ink-subtle">
                                                                                Selected:{' '}
                                                                                <span className="font-mono">
                                                                                  <span className="text-danger-ink">
                                                                                    {sheetName}
                                                                                  </span>
                                                                                  <span className="text-ink-subtle">
                                                                                    .
                                                                                  </span>
                                                                                  <span className="text-primary-ink">
                                                                                    {columnName}
                                                                                  </span>
                                                                                </span>
                                                                                {selectedAlternateOption.confidence
                                                                                  ? ` (${selectedAlternateOption.confidence})`
                                                                                  : ''}
                                                                                {selectedAlternateOption.blocked
                                                                                  ? ' • blocked candidate'
                                                                                  : ''}
                                                                              </p>
                                                                            );
                                                                          })()
                                                                        : null}
                                                                    </div>
                                                                  </td>
                                                                </tr>
                                                              ) : null}
                                                            </Fragment>
                                                          );
                                                        })}
                                                      </Fragment>
                                                    ))
                                                  ) : (
                                                    <tr>
                                                      <td
                                                        className="px-2 py-2 text-ink-subtle"
                                                        colSpan={7}
                                                      >
                                                        No mapping review item for this session.
                                                      </td>
                                                    </tr>
                                                  )}
                                                </tbody>
                                              </table>
                                            </div>

                                            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-canvas p-3">
                                              <p className="text-caption text-ink-subtle">
                                                {selectedMappingView?.approved ?? 0} of{' '}
                                                {selectedMappingView?.total ?? 0} mapping review
                                                items approved.
                                              </p>
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="primary"
                                                className="ml-auto"
                                                onClick={proceedToNextWorkflowStep}
                                                disabled={!canProceedToNextStep}
                                              >
                                                {submitDecision.isPending && canProceedToNextStep
                                                  ? 'Processing...'
                                                  : 'Next step'}
                                              </Button>
                                            </div>
                                          </section>
                                        </>
                                      ) : (
                                        <p className="text-ink-subtle">
                                          {mappingApprovals.length > 0
                                            ? 'Found pending mapping approvals, but they are not linked to the currently selected session. Try Refresh or select a different session.'
                                            : 'No pending column mapping proposal for this session.'}
                                        </p>
                                      )}
                                    </div>
                                  ) : isPlanApprovalStep ? (
                                    <div className="mt-2 space-y-1.5 rounded-md border border-hairline bg-canvas p-2.5">
                                      <p className="font-medium text-ink">Final plan snapshot</p>
                                      <p>
                                        <span className="font-medium text-ink">Plan title:</span>{' '}
                                        {plan?.title ?? 'No generated plan title.'}
                                      </p>
                                      <p>
                                        <span className="font-medium text-ink">
                                          Interpreted goal:
                                        </span>{' '}
                                        {(plan?.goal_summary ?? selectedSession.goal) || goalDraft}
                                      </p>
                                      <p>
                                        <span className="font-medium text-ink">Approved at:</span>{' '}
                                        {formatLocalDate(selectedSession.plan_approved_at)}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="mt-2 rounded-md border border-dashed border-hairline-strong bg-canvas px-2 py-1.5 text-ink-subtle">
                                      This step is planned and read-only for now. Implementation
                                      will be added in subsequent iteration.
                                    </p>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        </section>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </PageChrome>
  );
}
