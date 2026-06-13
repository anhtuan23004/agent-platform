import { Button, Dropzone, Input, Label, PageChrome, toast } from '@seta/shared-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, Circle, Loader2, MoveUpRight, RefreshCw, Workflow } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { WorkflowApprovalRow, WorkflowRunRow } from '@/modules/agent/workflows/api/schemas';
import { workflowsApi } from '@/modules/agent/workflows/api/workflows';
import { HitlCardHost } from '@/modules/agent/workflows/components/hitl-card-host';
import { RunStatusPill } from '@/modules/agent/workflows/components/run-status-pill';
import { usePendingApprovals } from '@/modules/agent/workflows/hooks/use-pending-approvals';
import { useSubmitDecision } from '@/modules/agent/workflows/hooks/use-submit-decision';
import { workflowsQueryKeys } from '@/modules/agent/workflows/state/query-keys';
import { useStartPmoIngest } from '../hooks/use-start-pmo-ingest';

const ACCEPT = '.xlsx,.xlsm';
const MAX_BYTES = 50 * 1024 * 1024;
const PMO_RUNS_QUERY_KEY = ['pmo', 'workflow-runs'] as const;

type TabKey = 'mapping' | 'db' | 'summary' | 'completed';
type StageKey = 'uploaded' | 'mapping' | 'db' | 'summary' | 'completed';

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

interface DbChangeRow {
  table: string;
  upsert: number;
  skip: number;
  newRows: number;
  updatedRows: number;
  exactDup: number;
  dupInUpload: number;
  status: 'approved' | 'pending';
}

interface DbViewModel {
  rowsToUpsert: number;
  rowsToSkip: number;
  newRows: number;
  updatedRows: number;
  exactDup: number;
  dupInUpload: number;
  blockingIssues: number;
  rows: DbChangeRow[];
}

interface RunViewModel {
  run: WorkflowRunRow;
  pendingApprovals: WorkflowApprovalRow[];
  mappingApproval: WorkflowApprovalRow | null;
  dbApproval: WorkflowApprovalRow | null;
  mappingView: MappingViewModel | null;
  dbView: DbViewModel | null;
  stage: StageKey;
  currentStepLabel: string;
  progressPct: number;
  progressText: string;
}

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'mapping', label: 'Mapping columns' },
  { key: 'db', label: 'DB changes' },
  { key: 'summary', label: 'Summary' },
  { key: 'completed', label: 'Completed' },
];

function readInputField(inputSummary: unknown, key: string): string | null {
  if (!inputSummary || typeof inputSummary !== 'object') return null;
  const value = (inputSummary as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function fileNameFromKey(fileKey: string | null): string {
  if (!fileKey) return '-';
  const parts = fileKey.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? fileKey;
}

function stageIndex(stage: StageKey): number {
  return STAGES.findIndex((s) => s.key === stage);
}

function defaultTabForStage(stage: StageKey): TabKey {
  if (stage === 'mapping') return 'mapping';
  if (stage === 'db') return 'db';
  if (stage === 'completed') return 'completed';
  return 'summary';
}

function stageForTab(tab: TabKey): StageKey {
  if (tab === 'mapping') return 'mapping';
  if (tab === 'db') return 'db';
  if (tab === 'summary') return 'summary';
  return 'completed';
}

function parseLeadingNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value.replaceAll(',', '').match(/-?\d+/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
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

function mapRows(rows: Array<{ k: string; v: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.k, row.v);
  return out;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function isRenderableApprovalPayload(
  payload: unknown,
): payload is { details: unknown[]; primary: { label: string }; decline: { label: string } } {
  if (!payload || typeof payload !== 'object') return false;
  const card = payload as {
    details?: unknown;
    primary?: { label?: unknown };
    decline?: { label?: unknown };
  };
  return (
    Array.isArray(card.details) &&
    typeof card.primary?.label === 'string' &&
    typeof card.decline?.label === 'string'
  );
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

function isDbChangesApprovalRow(approval: WorkflowApprovalRow): boolean {
  const stepId = approval.stepId;
  if (
    stepId === 'pmo.ingest.reviewChanges' ||
    stepId === 'reviewChanges' ||
    stepId.endsWith('.reviewChanges')
  ) {
    return true;
  }

  return cardToolIdFromPayload(approval.proposedPayload) === 'pmo_confirmPublish';
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

function parseMappingView(approval: WorkflowApprovalRow | null): MappingViewModel | null {
  if (!approval) return null;
  const payload = approval.proposedPayload;
  const tables = kvTablesFromPayload(approval.proposedPayload);
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

  if (isRenderableApprovalPayload(approval.proposedPayload)) {
    const alternates = (approval.proposedPayload as { alternates?: unknown }).alternates;
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

function parseMetrics(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const segment of raw.split('|')) {
    const [keyRaw, valueRaw] = segment.split('=');
    const key = keyRaw?.trim();
    const value = valueRaw?.trim();
    if (!key) continue;
    out[key] = parseLeadingNumber(value);
  }
  return out;
}

function parseDbView(approval: WorkflowApprovalRow | null): DbViewModel | null {
  if (!approval) return null;
  const tables = kvTablesFromPayload(approval.proposedPayload);
  if (tables.length === 0) return null;

  const summary = mapRows(tables[0] ?? []);
  const rows: DbChangeRow[] = [];

  for (const row of tables[1] ?? []) {
    const metrics = parseMetrics(row.v);
    const dupInUpload = metrics.dup_in_upload ?? 0;
    const updatedRows = metrics.updated ?? 0;

    rows.push({
      table: row.k,
      upsert: metrics.upsert ?? 0,
      skip: metrics.skip ?? 0,
      newRows: metrics.new ?? 0,
      updatedRows,
      exactDup: metrics.exact_dup ?? 0,
      dupInUpload,
      status: dupInUpload > 0 || updatedRows > 0 ? 'pending' : 'approved',
    });
  }

  return {
    rowsToUpsert: parseLeadingNumber(summary.get('Rows to upsert')),
    rowsToSkip: parseLeadingNumber(summary.get('Rows to skip')),
    newRows: parseLeadingNumber(summary.get('New rows')),
    updatedRows: parseLeadingNumber(summary.get('Updated rows')),
    exactDup: parseLeadingNumber(summary.get('Exact duplicates')),
    dupInUpload: parseLeadingNumber(summary.get('Duplicates in upload')),
    blockingIssues: parseLeadingNumber(summary.get('Blocking issues')),
    rows,
  };
}

function toRunView(run: WorkflowRunRow, pendingApprovals: WorkflowApprovalRow[]): RunViewModel {
  const mappingApproval = pendingApprovals.find(isMappingApprovalRow) ?? null;
  const dbApproval = pendingApprovals.find(isDbChangesApprovalRow) ?? null;

  const mappingView = parseMappingView(mappingApproval);
  const dbView = parseDbView(dbApproval);

  if (dbApproval) {
    const total = dbView?.rows.length ?? 0;
    const pending = dbView?.rows.filter((row) => row.status === 'pending').length ?? 0;
    const approved = Math.max(total - pending, 0);
    const progressPct = total > 0 ? Math.round((approved / total) * 100) : 60;

    return {
      run,
      pendingApprovals,
      mappingApproval,
      dbApproval,
      mappingView,
      dbView,
      stage: 'db',
      currentStepLabel: 'DB changes',
      progressPct,
      progressText: total > 0 ? `${approved} / ${total} (${progressPct}%)` : 'In review',
    };
  }

  if (mappingApproval) {
    const total = mappingView?.total ?? 0;
    const approved = mappingView?.approved ?? 0;
    const progressPct = total > 0 ? Math.round((approved / total) * 100) : 0;
    return {
      run,
      pendingApprovals,
      mappingApproval,
      dbApproval,
      mappingView,
      dbView,
      stage: 'mapping',
      currentStepLabel: 'Mapping columns',
      progressPct,
      progressText: total > 0 ? `${approved} / ${total} (${progressPct}%)` : 'In review',
    };
  }

  if (run.status === 'success') {
    return {
      run,
      pendingApprovals,
      mappingApproval,
      dbApproval,
      mappingView,
      dbView,
      stage: 'completed',
      currentStepLabel: 'Completed',
      progressPct: 100,
      progressText: '100%',
    };
  }

  if (run.status === 'running' || run.status === 'paused') {
    return {
      run,
      pendingApprovals,
      mappingApproval,
      dbApproval,
      mappingView,
      dbView,
      stage: 'summary',
      currentStepLabel: 'Summary',
      progressPct: 75,
      progressText: 'Pending',
    };
  }

  return {
    run,
    pendingApprovals,
    mappingApproval,
    dbApproval,
    mappingView,
    dbView,
    stage: 'uploaded',
    currentStepLabel: 'Uploaded',
    progressPct: 10,
    progressText: 'Pending',
  };
}

function stageState(stage: StageKey, currentStage: StageKey): 'done' | 'current' | 'pending' {
  const current = stageIndex(currentStage);
  const idx = stageIndex(stage);
  if (idx < current) return 'done';
  if (idx === current) return 'current';
  return 'pending';
}

function toneForState(state: 'done' | 'current' | 'pending'): {
  marker: string;
  text: string;
} {
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

function progressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  return `${clamped}%`;
}

function cardFromSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const snap = snapshot as {
    result?: { suspendPayload?: unknown };
    context?: Record<string, { suspendPayload?: unknown }>;
    suspendedPaths?: Record<string, unknown>;
  };

  if (snap.result?.suspendPayload && typeof snap.result.suspendPayload === 'object') {
    return snap.result.suspendPayload;
  }

  const suspendedStepId = snap.suspendedPaths ? Object.keys(snap.suspendedPaths)[0] : undefined;
  if (suspendedStepId && snap.context?.[suspendedStepId]?.suspendPayload) {
    return snap.context[suspendedStepId].suspendPayload;
  }

  if (snap.context) {
    for (const entry of Object.values(snap.context)) {
      if (entry?.suspendPayload && typeof entry.suspendPayload === 'object') {
        return entry.suspendPayload;
      }
    }
  }

  return undefined;
}

export function PmoPage() {
  const qc = useQueryClient();
  const [reportingPeriodKey, setReportingPeriodKey] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('mapping');
  const [selectedDbTable, setSelectedDbTable] = useState<string | null>(null);
  const [editingMappingKey, setEditingMappingKey] = useState<string | null>(null);
  const [selectedMappingAlternate, setSelectedMappingAlternate] = useState<number | null>(null);
  const [isCancelingWorkflow, setIsCancelingWorkflow] = useState(false);

  const startIngest = useStartPmoIngest();
  const pendingApprovals = usePendingApprovals();
  const submitDecision = useSubmitDecision();

  const runsQuery = useQuery({
    queryKey: PMO_RUNS_QUERY_KEY,
    queryFn: async () => {
      const out = await workflowsApi.listRuns({
        scope: 'self',
        workflowId: 'pmo.ingestData',
        limit: 50,
      });
      return out.rows;
    },
    refetchInterval: 10_000,
  });

  const pendingByRun = useMemo(() => {
    const map = new Map<string, WorkflowApprovalRow[]>();
    for (const approval of pendingApprovals.data ?? []) {
      const list = map.get(approval.runId) ?? [];
      list.push(approval);
      map.set(approval.runId, list);
    }
    return map;
  }, [pendingApprovals.data]);

  const runViews = useMemo(() => {
    const rows = [...(runsQuery.data ?? [])].sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
    return rows.map((run) => toRunView(run, pendingByRun.get(run.runId) ?? []));
  }, [runsQuery.data, pendingByRun]);

  const firstPendingRunId = useMemo(
    () => runViews.find((view) => view.pendingApprovals.length > 0)?.run.runId ?? null,
    [runViews],
  );

  useEffect(() => {
    const firstRun = runViews[0];
    if (runViews.length === 0) {
      setSelectedRunId(null);
      return;
    }

    if (!selectedRunId || !runViews.some((view) => view.run.runId === selectedRunId)) {
      setSelectedRunId(firstPendingRunId ?? (firstRun ? firstRun.run.runId : null));
    }
  }, [runViews, selectedRunId, firstPendingRunId]);

  const selectedView =
    runViews.find((view) => view.run.runId === selectedRunId) ?? runViews[0] ?? null;
  const latestView = runViews[0] ?? null;
  const selectedRunIdValue = selectedView?.run.runId;
  const selectedRunStatus = selectedView?.run.status;

  const selectedRunSnapshotQuery = useQuery({
    queryKey: ['pmo', 'run-snapshot', selectedRunIdValue],
    enabled: Boolean(selectedRunIdValue),
    queryFn: async () => {
      if (!selectedRunIdValue) return null;
      return workflowsApi.getRunSnapshot(selectedRunIdValue);
    },
    refetchInterval: selectedRunStatus === 'paused' ? 5000 : false,
  });

  const snapshotFallbackPayload = useMemo(
    () => cardFromSnapshot(selectedRunSnapshotQuery.data),
    [selectedRunSnapshotQuery.data],
  );

  const selectedMappingApproval = useMemo(() => {
    const approval = selectedView?.mappingApproval ?? null;
    if (!approval) return null;
    if (isRenderableApprovalPayload(approval.proposedPayload)) return approval;
    if (!isRenderableApprovalPayload(snapshotFallbackPayload)) return approval;
    return { ...approval, proposedPayload: snapshotFallbackPayload };
  }, [selectedView?.mappingApproval, snapshotFallbackPayload]);

  const selectedDbApproval = useMemo(() => {
    const approval = selectedView?.dbApproval ?? null;
    if (!approval) return null;
    if (isRenderableApprovalPayload(approval.proposedPayload)) return approval;
    if (!isRenderableApprovalPayload(snapshotFallbackPayload)) return approval;
    return { ...approval, proposedPayload: snapshotFallbackPayload };
  }, [selectedView?.dbApproval, snapshotFallbackPayload]);

  const selectedMappingView = useMemo(() => {
    if (selectedView?.stage === 'db' || selectedView?.stage === 'summary') {
      return parseMappingView(selectedDbApproval) ?? parseMappingView(selectedMappingApproval);
    }
    return parseMappingView(selectedMappingApproval) ?? parseMappingView(selectedDbApproval);
  }, [selectedView?.stage, selectedMappingApproval, selectedDbApproval]);

  const selectedDbView = useMemo(() => parseDbView(selectedDbApproval), [selectedDbApproval]);

  const selectedViewStage = selectedView?.stage;
  const selectedViewFirstDbTable = selectedDbView?.rows[0]?.table ?? null;

  useEffect(() => {
    if (!selectedViewStage) return;
    setActiveTab(defaultTabForStage(selectedViewStage));
    setSelectedDbTable(selectedViewFirstDbTable);
    setEditingMappingKey(null);
    setSelectedMappingAlternate(null);
  }, [selectedViewStage, selectedViewFirstDbTable]);

  const uploadError =
    startIngest.isError && startIngest.error
      ? startIngest.error instanceof Error
        ? startIngest.error.message
        : String(startIngest.error)
      : null;

  const overallStats = useMemo(() => {
    if (!selectedView) {
      return {
        stepText: 'No active session',
        pct: 0,
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
      };
    }

    if (selectedView.stage === 'mapping') {
      const total = selectedMappingView?.total ?? 0;
      const approved = selectedMappingView?.approved ?? 0;
      const pending = Math.max(total - approved, 0);
      const pct = total > 0 ? Math.round((approved / total) * 100) : 0;
      return {
        stepText: 'Step 2 of 5 - Mapping columns review',
        pct,
        total,
        approved,
        pending,
        rejected: 0,
      };
    }

    if (selectedView.stage === 'db') {
      const total = selectedDbView?.rows.length ?? 0;
      const pending = selectedDbView?.rows.filter((row) => row.status === 'pending').length ?? 0;
      const approved = Math.max(total - pending, 0);
      const pct = total > 0 ? Math.round((approved / total) * 100) : 60;
      return {
        stepText: 'Step 3 of 5 - DB changes review',
        pct,
        total,
        approved,
        pending,
        rejected: 0,
      };
    }

    if (selectedView.stage === 'completed') {
      return {
        stepText: 'Step 5 of 5 - Completed',
        pct: 100,
        total: 1,
        approved: 1,
        pending: 0,
        rejected: 0,
      };
    }

    return {
      stepText: 'Progress pending',
      pct: selectedView.progressPct,
      total: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
    };
  }, [selectedView, selectedMappingView, selectedDbView]);

  const selectedDbRow = useMemo(() => {
    if (!selectedDbView) return null;
    return (
      selectedDbView.rows.find((row) => row.table === selectedDbTable) ??
      selectedDbView.rows[0] ??
      null
    );
  }, [selectedDbView, selectedDbTable]);

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

  const canProceedToNextStep =
    Boolean(selectedMappingApproval) &&
    selectedMappingView?.awaitingNextStep === true &&
    !submitDecision.isPending;

  function refreshData() {
    void qc.invalidateQueries({ queryKey: PMO_RUNS_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: workflowsQueryKeys.pendingApprovals() });
    if (selectedRunIdValue) {
      void qc.invalidateQueries({ queryKey: ['pmo', 'run-snapshot', selectedRunIdValue] });
    }
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
        onSuccess: () => {
          toast.success('Mapping item approved', {
            description: 'The next mapping item is now ready for review.',
          });
          refreshData();
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
        onSuccess: () => {
          toast.success('Mapping updated', {
            description: 'The selected source column has been applied for this review item.',
          });
          setEditingMappingKey(null);
          setSelectedMappingAlternate(null);
          refreshData();
        },
        onError: (err) => {
          toast.error('Failed to update mapping', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  function proceedToDbReview() {
    if (!selectedMappingApproval) return;
    if (selectedMappingView?.awaitingNextStep !== true) return;

    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'approve',
      },
      {
        onSuccess: () => {
          toast.success('Moved to next step', {
            description: 'Workflow is continuing to DB changes review.',
          });
          refreshData();
        },
        onError: (err) => {
          toast.error('Failed to proceed to next step', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  async function cancelCurrentWorkflow() {
    if (!selectedView) return;
    if (selectedView.run.status === 'success' || selectedView.run.status === 'failed') return;

    setIsCancelingWorkflow(true);
    try {
      await workflowsApi.cancelRun(selectedView.run.runId);
      toast.success('Workflow canceled', {
        description: 'This workflow run was canceled from the PMO page.',
      });
      refreshData();
    } catch (err) {
      toast.error('Failed to cancel workflow', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsCancelingWorkflow(false);
    }
  }

  function openRun(runId: string, stage: StageKey) {
    setSelectedRunId(runId);
    setActiveTab(defaultTabForStage(stage));
  }

  function onFile(file: File) {
    const period = reportingPeriodKey.trim();
    startIngest.mutate(
      {
        file,
        reportingPeriodKey: period.length > 0 ? period : undefined,
      },
      {
        onSuccess: (out) => {
          toast.success('PMO workflow started', {
            description: 'Review mapping and DB change approvals directly from this PMO page.',
          });
          setSelectedRunId(out.runId);
          refreshData();
        },
        onError: (err) => {
          toast.error("Couldn't start PMO workflow", {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  return (
    <PageChrome
      breadcrumb={['Work']}
      title="PMO Ingestion"
      subtitle="Upload workbook, review mappings and staged changes, then publish."
      actions={
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={refreshData}>
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
                  Upload workbook, review mapping items one-by-one, review DB changes, then publish.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <section className="space-y-2">
                <Label htmlFor="reporting-period-key">Reporting period key (optional)</Label>
                <Input
                  id="reporting-period-key"
                  value={reportingPeriodKey}
                  onChange={(e) => setReportingPeriodKey(e.target.value)}
                  placeholder="e.g. 2025-W35"
                  disabled={startIngest.isPending}
                />
              </section>

              <Dropzone
                accept={ACCEPT}
                maxBytes={MAX_BYTES}
                label="Drop PMO workbook here, or click to choose"
                hint="XLSX / XLSM · up to 50 MB"
                pendingLabel="Uploading and starting workflow..."
                tooLargeMessage="That file is over 50 MB. Try a smaller workbook."
                isPending={startIngest.isPending}
                error={uploadError}
                onFile={onFile}
              />
            </div>

            {startIngest.isPending ? (
              <div className="mt-3 flex items-center gap-2 text-body-sm text-ink-subtle">
                <Loader2 className="size-4 animate-spin" />
                Creating ingestion session and starting PMO workflow...
              </div>
            ) : null}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
              <h3 className="text-body-sm font-semibold text-ink">Latest upload</h3>
              {latestView ? (
                <div className="mt-2.5 space-y-2.5">
                  <div>
                    <p className="text-card-title font-semibold text-ink">
                      {fileNameFromKey(readInputField(latestView.run.inputSummary, 'fileKey'))}
                    </p>
                    <p className="text-caption text-ink-subtle">
                      Uploaded by {shortId(latestView.run.startedBy)} ·{' '}
                      {displayDate(latestView.run.startedAt)}
                    </p>
                  </div>

                  <ol className="grid grid-cols-5 gap-1.5 rounded-lg border border-hairline bg-surface-1 p-2">
                    {STAGES.map((stage, idx) => {
                      const state = stageState(stage.key, latestView.stage);
                      const tone = toneForState(state);
                      return (
                        <li key={stage.key} className="space-y-1 text-center">
                          <span
                            className={`mx-auto flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold ${tone.marker}`}
                          >
                            {state === 'done' ? (
                              <CheckCircle2 className="size-3.5" />
                            ) : state === 'pending' ? (
                              <Circle className="size-3.5" />
                            ) : (
                              idx + 1
                            )}
                          </span>
                          <p className={`text-[11px] font-medium leading-tight ${tone.text}`}>
                            {stage.label}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : (
                <p className="mt-2 text-body-sm text-ink-subtle">No upload session yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
              <h3 className="text-body-sm font-semibold text-ink">Overall progress</h3>
              <p className="mt-0.5 text-caption text-ink-subtle">{overallStats.stepText}</p>

              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-warning"
                  style={{ width: progressBar(overallStats.pct) }}
                />
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 text-caption sm:grid-cols-4">
                <div className="rounded-lg border border-hairline bg-surface-1 px-2 py-1.5">
                  <p className="text-ink-subtle">Total review items</p>
                  <p className="text-body-sm font-semibold text-ink">{overallStats.total}</p>
                </div>
                <div className="rounded-lg border border-hairline bg-surface-1 px-2 py-1.5">
                  <p className="text-ink-subtle">Approved</p>
                  <p className="text-body-sm font-semibold text-success-ink">
                    {overallStats.approved}
                  </p>
                </div>
                <div className="rounded-lg border border-hairline bg-surface-1 px-2 py-1.5">
                  <p className="text-ink-subtle">Pending</p>
                  <p className="text-body-sm font-semibold text-warning-ink">
                    {overallStats.pending}
                  </p>
                </div>
                <div className="rounded-lg border border-hairline bg-surface-1 px-2 py-1.5">
                  <p className="text-ink-subtle">Rejected</p>
                  <p className="text-body-sm font-semibold text-danger-ink">
                    {overallStats.rejected}
                  </p>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-body-sm font-semibold text-ink">Upload history</h3>
                <p className="text-caption text-ink-subtle">
                  Select a session to inspect mapping and DB review details.
                </p>
              </div>
            </div>

            {runsQuery.isLoading ? (
              <p className="text-body-sm text-ink-subtle">Loading PMO sessions...</p>
            ) : null}

            {runsQuery.isError ? (
              <p className="text-body-sm text-danger-ink">
                Failed to load PMO sessions:{' '}
                {runsQuery.error instanceof Error
                  ? runsQuery.error.message
                  : String(runsQuery.error)}
              </p>
            ) : null}

            {!runsQuery.isLoading && !runsQuery.isError && runViews.length === 0 ? (
              <p className="text-body-sm text-ink-subtle">
                No PMO sessions yet. Upload a workbook to start one.
              </p>
            ) : null}

            {runViews.length > 0 ? (
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
                      <th className="px-2 py-2">Approval progress</th>
                      <th className="px-2 py-2">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runViews.map((view, index) => {
                      const selected = selectedRunId === view.run.runId;
                      const needsReview = view.pendingApprovals.length > 0;
                      return (
                        <tr
                          key={view.run.runId}
                          className={`border-b border-hairline ${selected ? 'bg-primary-tint/30' : ''}`}
                        >
                          <td className="px-2 py-2 text-ink-subtle">{index + 1}</td>
                          <td className="px-2 py-2 font-medium text-ink">
                            {fileNameFromKey(readInputField(view.run.inputSummary, 'fileKey'))}
                          </td>
                          <td className="px-2 py-2 text-ink-subtle">
                            {displayDate(view.run.startedAt)}
                          </td>
                          <td className="px-2 py-2 text-ink-subtle">
                            {shortId(view.run.startedBy)}
                          </td>
                          <td className="px-2 py-2">
                            {needsReview ? (
                              <span className="rounded-full bg-warning-tint px-2 py-0.5 text-caption font-medium text-warning-ink">
                                Needs review
                              </span>
                            ) : (
                              <RunStatusPill status={view.run.status} />
                            )}
                          </td>
                          <td className="px-2 py-2 text-ink-subtle">{view.currentStepLabel}</td>
                          <td className="px-2 py-2">
                            <div className="w-[160px]">
                              <p className="text-caption text-ink-subtle">{view.progressText}</p>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                                <div
                                  className="h-full rounded-full bg-success"
                                  style={{ width: progressBar(view.progressPct) }}
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
                                onClick={() => openRun(view.run.runId, view.stage)}
                              >
                                {needsReview ? 'Review now' : 'View'}
                              </Button>
                              <Link
                                to="/agent/workflows/runs/$runId"
                                params={{ runId: view.run.runId }}
                                search={{}}
                              >
                                <Button size="sm" variant="secondary" type="button">
                                  <MoveUpRight className="size-3" />
                                </Button>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          {selectedView ? (
            <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-hairline pb-2.5">
                {(
                  [
                    { key: 'mapping', label: 'Mapping columns' },
                    { key: 'db', label: 'DB changes' },
                    { key: 'summary', label: 'Summary' },
                    { key: 'completed', label: 'Completed' },
                  ] as Array<{ key: TabKey; label: string }>
                ).map((tab, idx) => {
                  const selected = activeTab === tab.key;
                  const tabStage = stageForTab(tab.key);
                  const stageStateNow = stageState(tabStage, selectedView.stage);
                  const canOpenTab = stageIndex(tabStage) <= stageIndex(selectedView.stage);
                  const badge =
                    stageStateNow === 'done'
                      ? 'Approved'
                      : stageStateNow === 'current'
                        ? 'In review'
                        : 'Pending';

                  return (
                    <Button
                      key={tab.key}
                      type="button"
                      size="sm"
                      variant={selected ? 'primary' : 'secondary'}
                      disabled={!canOpenTab}
                      onClick={() => {
                        if (!canOpenTab) return;
                        setActiveTab(tab.key);
                      }}
                    >
                      <span className="text-caption text-ink-subtle">{idx + 1}</span>
                      {tab.label}
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-subtle">
                        {badge}
                      </span>
                    </Button>
                  );
                })}
              </div>

              {activeTab === 'mapping' ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
                    Mapping review is required. The workflow proceeds only after all mapping items
                    are approved and you click Next step.
                  </div>

                  <section className="rounded-lg border border-hairline bg-surface-1 p-3">
                    <h4 className="text-body-sm font-semibold text-ink">Review column mappings</h4>
                    <p className="mt-1 text-caption text-ink-subtle">
                      Approve each mapping item individually. The workflow proceeds only after all
                      mapping items are approved and you click Next step.
                    </p>

                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-caption">
                        <thead className="border-b border-hairline text-ink-subtle">
                          <tr>
                            <th className="px-2 py-1.5">Source column</th>
                            <th className="px-2 py-1.5">Target DB column</th>
                            <th className="px-2 py-1.5">Issue type</th>
                            <th className="px-2 py-1.5">Status</th>
                            <th className="px-2 py-1.5">Approved by</th>
                            <th className="px-2 py-1.5">Confidence score</th>
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
                                    selectedMappingView?.alternatesByItemKey.get(item.key) ?? [];
                                  const canApprove =
                                    Boolean(selectedMappingApproval) &&
                                    item.actionType === 'approve_and_modify' &&
                                    item.state === 'current' &&
                                    !submitDecision.isPending;
                                  const canModify =
                                    Boolean(selectedMappingApproval) &&
                                    alternatesForItem.length > 0 &&
                                    !submitDecision.isPending;
                                  const isEditingItem = editingMappingKey === item.key;

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
                                          {item.approvedBy ? shortId(item.approvedBy) : '-'}
                                        </td>
                                        <td className="px-2 py-1.5 text-ink-subtle">
                                          {item.confidence ?? '-'}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          <div className="flex items-center gap-1.5">
                                            {item.actionType === 'approve_and_modify' ? (
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                disabled={!canApprove}
                                                onClick={approveCurrentMappingItem}
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
                                              onClick={() => openMappingModify(item.key)}
                                            >
                                              Modify
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>

                                      {isEditingItem ? (
                                        <tr className="border-b border-hairline bg-canvas/60">
                                          <td colSpan={7} className="px-2 py-2">
                                            <div className="rounded-md border border-hairline bg-canvas p-3">
                                              <p className="text-caption font-medium text-ink">
                                                Modify current mapping
                                              </p>
                                              <p className="mt-1 text-caption text-ink-subtle">
                                                Modify only changes the source column from sheet
                                                data. Target DB column stays dim_{item.table}.
                                                {item.field}.
                                              </p>

                                              <div className="mt-2 space-y-2">
                                                <p className="text-caption text-ink-subtle">
                                                  Candidate source mapping
                                                </p>

                                                <div className="space-y-1.5">
                                                  {editingMappingAlternates.map((option) => {
                                                    const isSelected =
                                                      selectedMappingAlternate ===
                                                      option.alternateIndex;
                                                    const { sheetName, columnName } =
                                                      splitSheetAndColumn(
                                                        option.sourceColumn,
                                                        editingMappingItem?.sourceSheet ??
                                                          item.sourceSheet,
                                                      );

                                                    return (
                                                      <button
                                                        key={option.alternateIndex}
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
                                                        disabled={submitDecision.isPending}
                                                      >
                                                        <span className="font-mono text-body-sm">
                                                          <span className="text-danger-ink">
                                                            {sheetName}
                                                          </span>
                                                          <span className="text-ink-subtle">.</span>
                                                          <span className="text-primary-ink">
                                                            {columnName}
                                                          </span>
                                                        </span>

                                                        <span className="text-caption text-ink-subtle">
                                                          {option.confidence
                                                            ? option.confidence
                                                            : 'confidence -'}
                                                          {option.blocked ? ' • blocked' : ''}
                                                        </span>
                                                      </button>
                                                    );
                                                  })}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-2 text-caption text-ink-subtle">
                                                  <span className="font-medium text-ink-subtle">
                                                    Color guide:
                                                  </span>
                                                  <span>
                                                    <span className="font-medium text-danger-ink">
                                                      sheet_name
                                                    </span>{' '}
                                                    = source sheet
                                                  </span>
                                                  <span>
                                                    <span className="font-medium text-primary-ink">
                                                      column_name
                                                    </span>{' '}
                                                    = source column
                                                  </span>
                                                </div>
                                              </div>

                                              <div className="mt-2 flex flex-wrap items-end gap-2">
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="primary"
                                                  disabled={
                                                    selectedMappingAlternate === null ||
                                                    submitDecision.isPending
                                                  }
                                                  onClick={applyMappingModify}
                                                >
                                                  {submitDecision.isPending
                                                    ? 'Applying...'
                                                    : 'Apply change'}
                                                </Button>
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="secondary"
                                                  disabled={submitDecision.isPending}
                                                  onClick={() => {
                                                    setEditingMappingKey(null);
                                                    setSelectedMappingAlternate(null);
                                                  }}
                                                >
                                                  Cancel
                                                </Button>
                                              </div>

                                              {selectedAlternateOption
                                                ? (() => {
                                                    const { sheetName, columnName } =
                                                      splitSheetAndColumn(
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
                                                          <span className="text-ink-subtle">.</span>
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
                              <td className="px-2 py-2 text-ink-subtle" colSpan={7}>
                                No mapping review item for this session.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-canvas p-3">
                      <p className="text-caption text-ink-subtle">
                        {selectedMappingView?.approved ?? 0} of {selectedMappingView?.total ?? 0}{' '}
                        mapping review items approved.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        className="ml-auto"
                        onClick={proceedToDbReview}
                        disabled={!canProceedToNextStep}
                      >
                        {submitDecision.isPending && canProceedToNextStep
                          ? 'Processing...'
                          : 'Next step'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={
                          isCancelingWorkflow ||
                          !selectedView ||
                          selectedView.run.status === 'success' ||
                          selectedView.run.status === 'failed' ||
                          selectedView.run.status === 'canceled'
                        }
                        onClick={cancelCurrentWorkflow}
                      >
                        {isCancelingWorkflow ? 'Canceling...' : 'Cancel workflow'}
                      </Button>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeTab === 'db' ? (
                <div className="space-y-3">
                  <h3 className="text-body-sm font-semibold text-ink">Review changes</h3>
                  <div className="rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
                    You cannot continue until DB review issues are approved or resolved.
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
                    <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-3">
                      <div className="rounded-lg border border-hairline bg-canvas p-3">
                        <p className="text-caption font-medium text-ink">
                          Rows skipped (exact duplicates)
                        </p>
                        <p className="mt-1 text-body-sm text-ink-subtle">
                          Rows skipped: {selectedDbView?.rowsToSkip ?? 0}
                        </p>
                      </div>
                      <div className="rounded-lg border border-hairline bg-canvas p-3">
                        <p className="text-caption font-medium text-ink">Rows to upsert</p>
                        <p className="mt-1 text-body-sm text-ink-subtle">
                          Rows to upsert: {selectedDbView?.rowsToUpsert ?? 0}
                        </p>
                      </div>
                    </section>

                    <section className="rounded-lg border border-hairline bg-surface-1 p-3">
                      <h4 className="text-body-sm font-semibold text-ink">
                        DB change impact by table
                      </h4>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-caption">
                          <thead className="border-b border-hairline text-ink-subtle">
                            <tr>
                              <th className="px-2 py-1.5">Table</th>
                              <th className="px-2 py-1.5">Rows to upsert</th>
                              <th className="px-2 py-1.5">Rows to skip</th>
                              <th className="px-2 py-1.5">Rows updated</th>
                              <th className="px-2 py-1.5">Review status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedDbView?.rows.length ? (
                              selectedDbView.rows.map((row) => (
                                <tr
                                  key={row.table}
                                  className={`cursor-pointer border-b border-hairline last:border-b-0 ${
                                    selectedDbRow?.table === row.table ? 'bg-primary-tint/30' : ''
                                  }`}
                                  onClick={() => setSelectedDbTable(row.table)}
                                >
                                  <td className="px-2 py-1.5 font-medium text-ink">{row.table}</td>
                                  <td className="px-2 py-1.5 text-ink-subtle">{row.upsert}</td>
                                  <td className="px-2 py-1.5 text-ink-subtle">{row.skip}</td>
                                  <td className="px-2 py-1.5 text-ink-subtle">{row.updatedRows}</td>
                                  <td className="px-2 py-1.5">
                                    {row.status === 'approved' ? (
                                      <span className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-ink">
                                        Approved
                                      </span>
                                    ) : (
                                      <span className="rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-ink">
                                        Pending
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="px-2 py-2 text-ink-subtle" colSpan={5}>
                                  No DB change review items for this session.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="rounded-lg border border-hairline bg-surface-1 p-3">
                      <h4 className="text-body-sm font-semibold text-ink">
                        Selected table details
                      </h4>
                      {selectedDbRow ? (
                        <div className="mt-3 space-y-2 text-caption">
                          <p className="text-ink-subtle">Table</p>
                          <p className="font-medium text-ink">{selectedDbRow.table}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-lg border border-hairline bg-canvas px-2 py-2">
                              <p className="text-ink-subtle">New rows</p>
                              <p className="font-semibold text-ink">{selectedDbRow.newRows}</p>
                            </div>
                            <div className="rounded-lg border border-hairline bg-canvas px-2 py-2">
                              <p className="text-ink-subtle">Updated rows</p>
                              <p className="font-semibold text-ink">{selectedDbRow.updatedRows}</p>
                            </div>
                            <div className="rounded-lg border border-hairline bg-canvas px-2 py-2">
                              <p className="text-ink-subtle">Exact dup</p>
                              <p className="font-semibold text-ink">{selectedDbRow.exactDup}</p>
                            </div>
                            <div className="rounded-lg border border-hairline bg-canvas px-2 py-2">
                              <p className="text-ink-subtle">Dup in upload</p>
                              <p className="font-semibold text-ink">{selectedDbRow.dupInUpload}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 text-caption text-ink-subtle">
                          Select one table row to inspect details.
                        </p>
                      )}
                    </section>
                  </div>

                  {selectedDbApproval ? (
                    <div className="rounded-lg border border-hairline bg-surface-1 p-3">
                      <HitlCardHost
                        approval={selectedDbApproval}
                        canAct
                        threadId={selectedDbApproval.surfaceChatThreadId ?? undefined}
                      />
                    </div>
                  ) : (
                    <p className="text-caption text-ink-subtle">
                      No pending DB review approval in this session.
                    </p>
                  )}
                </div>
              ) : null}

              {activeTab === 'summary' ? (
                <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                  Summary view is available after mapping and DB review approvals are completed.
                </section>
              ) : null}

              {activeTab === 'completed' ? (
                <section className="rounded-lg border border-success-border bg-success-tint p-4 text-body-sm text-success-ink">
                  This PMO ingestion session is completed.
                </section>
              ) : null}
            </section>
          ) : null}

          {startIngest.data ? (
            <section className="rounded-lg border border-primary-border bg-primary-tint p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-primary-ink">
                    Workflow run ready: {shortId(startIngest.data.runId)}
                  </p>
                  <p className="text-caption text-primary-ink/80">
                    Session {shortId(startIngest.data.ingestionSessionId)} created.
                  </p>
                </div>
                <Link
                  to="/agent/workflows/runs/$runId"
                  params={{ runId: startIngest.data.runId }}
                  search={{}}
                >
                  <Button size="sm" variant="secondary" type="button">
                    Open workflow graph
                    <MoveUpRight className="size-3" />
                  </Button>
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageChrome>
  );
}
