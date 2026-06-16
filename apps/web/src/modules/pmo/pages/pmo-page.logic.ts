import type { WorkflowApprovalRow, WorkflowRunRow } from '../../agent/workflows/api/schemas.ts';
import type {
  PmoPlanningSession,
  PmoSessionDocumentProfileRecord,
  PmoWorkflowExecutionStepStatus,
} from '../api/client';

export type TimelineState = 'done' | 'current' | 'pending';

export type ExecutionCard = {
  step_no: number;
  step_name: string;
  status: PmoWorkflowExecutionStepStatus;
  description?: string;
};

export type ExecutionActionGroup = {
  id: 'needs_action' | 'in_progress' | 'upcoming' | 'completed' | 'cancelled';
  title: string;
  hint: string;
  badgeTone: string;
  steps: ExecutionCard[];
};

export interface MappingProgressItem {
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

export interface MappingAlternateOption {
  alternateIndex: number;
  itemKey: string;
  sourceColumn: string;
  confidence: string | null;
  blocked: boolean;
}

export interface MappingViewModel {
  approved: number;
  total: number;
  items: MappingProgressItem[];
  current: Map<string, string>;
  currentKey: string | null;
  alternatesByItemKey: Map<string, MappingAlternateOption[]>;
  awaitingNextStep: boolean;
}

export function groupExecutionCardsByAction(cards: ExecutionCard[]): ExecutionActionGroup[] {
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

export function formatLocalDate(isoText: string | null | undefined): string {
  if (!isoText) {
    return '-';
  }

  const parsed = new Date(isoText);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }

  return parsed.toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function profilingSheetKey(documentId: string, sheetName: string): string {
  return `${documentId}::${sheetName}`;
}

export function shortId(value: string): string {
  return value.slice(0, 8);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function splitSheetAndColumn(
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

export function isMappingApprovalRow(approval: WorkflowApprovalRow): boolean {
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

export function readIngestionSessionIdFromApproval(approval: WorkflowApprovalRow): string | null {
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

export function sessionIdsMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function readIngestionSessionIdFromRunInput(inputSummary: unknown): string | null {
  if (!inputSummary || typeof inputSummary !== 'object') return null;
  const summary = inputSummary as {
    ingestionSessionId?: unknown;
    ingestion_session_id?: unknown;
  };

  if (typeof summary.ingestionSessionId === 'string' && summary.ingestionSessionId.trim()) {
    return summary.ingestionSessionId.trim();
  }

  if (typeof summary.ingestion_session_id === 'string' && summary.ingestion_session_id.trim()) {
    return summary.ingestion_session_id.trim();
  }

  return null;
}

export function readActiveWorkflowStepId(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const snap = snapshot as {
    suspendedPaths?: Record<string, unknown>;
    context?: Record<string, { status?: unknown }>;
  };

  const suspendedStepId = snap.suspendedPaths ? Object.keys(snap.suspendedPaths)[0] : null;
  if (suspendedStepId) return suspendedStepId;

  const contextEntries = Object.entries(snap.context ?? {});
  for (const [stepId, entry] of contextEntries) {
    const status = typeof entry?.status === 'string' ? entry.status.toLowerCase() : '';
    if (
      status === 'running' ||
      status === 'in_progress' ||
      status === 'suspended' ||
      status === 'paused'
    ) {
      return stepId;
    }
  }

  for (const [stepId, entry] of contextEntries) {
    const status = typeof entry?.status === 'string' ? entry.status.toLowerCase() : '';
    if (status === 'needs_review') return stepId;
  }

  return null;
}

export function executionStepMatchesRuntimeStep(
  step: ExecutionCard,
  runtimeStepId: string,
): boolean {
  const runtime = runtimeStepId.toLowerCase();
  const stepName = step.step_name.toLowerCase();

  if (runtime.includes('confirmmapping')) {
    return /mapping|confirm/.test(stepName);
  }

  if (runtime.includes('normalize')) {
    return /normalize|staging/.test(stepName);
  }

  if (runtime.includes('reviewchanges')) {
    return /review|readiness|impact|database|publish/.test(stepName);
  }

  if (runtime.includes('detect')) {
    return /profil|schema|detect/.test(stepName);
  }

  const runtimeTail = runtime.replace(/^.*\./, '');
  return runtimeTail.length > 0 ? stepName.includes(runtimeTail) : false;
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

export function parseMappingView(approval: WorkflowApprovalRow | null): MappingViewModel | null {
  if (!approval) return null;
  return parseMappingViewPayload(approval.proposedPayload);
}

export function toneForState(state: TimelineState): { marker: string; text: string } {
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

export function statusTone(statusLabel: string): string {
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

export function proposedStepTone(status: PmoWorkflowExecutionStepStatus): {
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

export function workflowStepTone(status: PmoWorkflowExecutionStepStatus): {
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

export function documentStatusTone(status: PmoSessionDocumentProfileRecord['status']): {
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

export function buildExecutionCards(session: PmoPlanningSession | null): ExecutionCard[] {
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

export function buildPlanningTimeline(
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

export function resolveExecutionCurrentStepIndex(params: {
  cards: ExecutionCard[];
  runtimeActiveStepId: string | null;
  executionCurrentStepNo: number | null;
}): number {
  const { cards, runtimeActiveStepId, executionCurrentStepNo } = params;
  if (cards.length === 0) return -1;

  if (runtimeActiveStepId) {
    const runtimeIndex = cards.findIndex((step) =>
      executionStepMatchesRuntimeStep(step, runtimeActiveStepId),
    );
    if (runtimeIndex >= 0) return runtimeIndex;
  }

  if (typeof executionCurrentStepNo === 'number') {
    const stateIndex = cards.findIndex((step) => step.step_no === executionCurrentStepNo);
    if (stateIndex >= 0) return stateIndex;
  }

  const activeStatusIndex = cards.findIndex(
    (step) =>
      step.status === 'in_progress' ||
      step.status === 'needs_review' ||
      step.status === 'failed' ||
      step.status === 'cancelled',
  );
  if (activeStatusIndex >= 0) return activeStatusIndex;

  const pendingIndex = cards.findIndex((step) => step.status === 'pending');
  if (pendingIndex >= 0) return pendingIndex;

  return cards.length - 1;
}

export function buildExecutionRuntimeTimeline(params: {
  cards: ExecutionCard[];
  currentStepIndex: number;
  runStatus: WorkflowRunRow['status'] | null;
}): Array<{ id: number; label: string; state: TimelineState }> {
  const { cards, currentStepIndex, runStatus } = params;
  if (cards.length === 0) return [];

  if (runStatus === 'success') {
    return cards.map((step, index) => ({
      id: index + 1,
      label: step.step_name,
      state: 'done',
    }));
  }

  return cards.map((step, index) => {
    if (currentStepIndex >= 0) {
      if (index < currentStepIndex) {
        return { id: index + 1, label: step.step_name, state: 'done' as const };
      }

      if (index === currentStepIndex) {
        return { id: index + 1, label: step.step_name, state: 'current' as const };
      }

      return { id: index + 1, label: step.step_name, state: 'pending' as const };
    }

    if (step.status === 'completed') {
      return { id: index + 1, label: step.step_name, state: 'done' as const };
    }

    if (step.status === 'pending') {
      return { id: index + 1, label: step.step_name, state: 'pending' as const };
    }

    return { id: index + 1, label: step.step_name, state: 'current' as const };
  });
}
