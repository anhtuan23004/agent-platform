import type {
  PmoPlanningSession,
  PmoSessionDocumentProfileRecord,
  PmoStepViewState,
  PmoWorkflowExecutionStepStatus,
} from '../api/client';
import type { WorkflowApprovalRow, WorkflowRunRow } from '../api/workflow-runtime';

export type TimelineState = 'done' | 'current' | 'pending';

export type PmoPlanActionId =
  | 'workbook_profiling'
  | 'column_mapping'
  | 'normalize_to_staging'
  | 'database_change_summary'
  | 'publish_after_approval'
  | 'generate_report'
  | 'generic_review';

export type PmoReviewType =
  | 'none'
  | 'profiling'
  | 'mapping'
  | 'normalization'
  | 'publish'
  | 'report'
  | 'generic';

export type ExecutionCard = {
  step_no: number;
  planner_step_id?: string;
  action_id?: string;
  review_type?: string;
  step_name: string;
  status: PmoWorkflowExecutionStepStatus;
  description?: string;
  output_summary?: Record<string, unknown>;
  view_state?: PmoStepViewState;
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

export interface PublishReviewViewModel {
  summary: string;
  primaryLabel: string;
  declineLabel: string | null;
  canApprove: boolean;
  willPublish: boolean;
  summaryRows: Array<{ k: string; v: string }>;
  tableRows: Array<{ k: string; v: string }>;
  issueRows: Array<{ k: string; v: string }>;
  checklist: string[];
}

export interface MissingMemberReference {
  memberId: string;
  source: string;
  reason: string;
}

export interface NormalizationReviewColumn {
  key: string;
  label: string;
}

export interface NormalizationReviewRow {
  id: string;
  groupId: string;
  groupLabel: string;
  tableId: string;
  sourceSheet: string | null;
  sourceRow: number;
  status: 'blocked' | 'duplicate' | 'warning' | 'skipped';
  issueType: string;
  issueLabel: string;
  issueDetail: string;
  values: Record<string, unknown>;
  columns: NormalizationReviewColumn[];
  problemFields: string[];
  duplicateGroupKey: string | null;
  duplicateOfRowId: string | null;
  decision: 'keep_row' | 'skip_row' | 'skipped';
  editable: boolean;
}

export interface NormalizationReviewIssueGroup {
  groupId: string;
  groupLabel: string;
  rows: NormalizationReviewRow[];
}

export interface NormalizationReviewTableGroup {
  tableId: string;
  sourceSheet: string | null;
  columns: NormalizationReviewColumn[];
  rows: NormalizationReviewRow[];
  issueGroups: NormalizationReviewIssueGroup[];
  totals: {
    issues: number;
    blocked: number;
    duplicates: number;
    missingFields: number;
    missingRefs: number;
    skipped: number;
  };
}

export interface NormalizationReviewViewModel extends PublishReviewViewModel {
  missingMembers: MissingMemberReference[];
  reviewRows: NormalizationReviewRow[];
  tableGroups: NormalizationReviewTableGroup[];
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

function cardMetaStringFromPayload(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readAgentNoteFromApproval(approval: WorkflowApprovalRow): string | null {
  const payload = approval.proposedPayload;
  if (!payload || typeof payload !== 'object') return null;
  const card = payload as { agentNote?: unknown };
  return typeof card.agentNote === 'string' && card.agentNote.trim().length > 0
    ? card.agentNote.trim()
    : null;
}

export function readClarificationsFromApproval(
  approval: WorkflowApprovalRow,
): Array<{ role: string; message: string; ts: string }> {
  const payload = approval.proposedPayload;
  if (!payload || typeof payload !== 'object') return [];
  const card = payload as { clarifications?: unknown };
  return Array.isArray(card.clarifications) ? card.clarifications : [];
}

export function readPlannerStepIdFromApproval(approval: WorkflowApprovalRow): string | null {
  return cardMetaStringFromPayload(approval.proposedPayload, 'plannerStepId');
}

export function readActionIdFromApproval(approval: WorkflowApprovalRow): string | null {
  return cardMetaStringFromPayload(approval.proposedPayload, 'actionId');
}

export function readReviewTypeFromApproval(approval: WorkflowApprovalRow): string | null {
  return cardMetaStringFromPayload(approval.proposedPayload, 'reviewType');
}

export function isMappingApprovalRow(approval: WorkflowApprovalRow): boolean {
  const reviewType = readReviewTypeFromApproval(approval);
  const actionId = readActionIdFromApproval(approval);
  if (reviewType === 'mapping' || actionId === 'column_mapping') return true;

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

export function isPublishApprovalRow(approval: WorkflowApprovalRow): boolean {
  const reviewType = readReviewTypeFromApproval(approval);
  const actionId = readActionIdFromApproval(approval);
  if (
    reviewType === 'publish' ||
    actionId === 'publish_after_approval' ||
    actionId === 'database_change_summary'
  ) {
    return true;
  }

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

export function isReportApprovalRow(approval: WorkflowApprovalRow): boolean {
  const reviewType = readReviewTypeFromApproval(approval);
  const actionId = readActionIdFromApproval(approval);
  if (reviewType === 'report' || actionId === 'generate_report') return true;

  const stepId = approval.stepId;
  if (
    stepId === 'pmo.ingest.confirmReportRange' ||
    stepId === 'confirmReportRange' ||
    stepId.endsWith('.confirmReportRange')
  ) {
    return true;
  }

  return cardToolIdFromPayload(approval.proposedPayload) === 'pmo_confirmReportRange';
}

export function isNormalizationApprovalRow(approval: WorkflowApprovalRow): boolean {
  const reviewType = readReviewTypeFromApproval(approval);
  const actionId = readActionIdFromApproval(approval);
  if (reviewType === 'normalization' || actionId === 'normalize_to_staging') return true;

  const stepId = approval.stepId;
  if (
    stepId === 'pmo.ingest.normalizeToStaging' ||
    stepId === 'normalizeToStaging' ||
    stepId.endsWith('.normalizeToStaging')
  ) {
    return true;
  }

  return cardToolIdFromPayload(approval.proposedPayload) === 'pmo_reviewNormalization';
}

export function isProfilingApprovalRow(approval: WorkflowApprovalRow): boolean {
  const reviewType = readReviewTypeFromApproval(approval);
  const actionId = readActionIdFromApproval(approval);
  if (reviewType === 'profiling' || actionId === 'workbook_profiling') return true;

  const stepId = approval.stepId;
  if (
    stepId === 'pmo.ingest.workbookProfiling' ||
    stepId === 'workbookProfiling' ||
    stepId.endsWith('.workbookProfiling')
  ) {
    return true;
  }

  return cardToolIdFromPayload(approval.proposedPayload) === 'pmo_profileWorkbook';
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
  const actionId = step.action_id;
  const plannerStepId = step.planner_step_id?.toLowerCase();

  if (plannerStepId && runtime.includes(plannerStepId)) return true;

  if (runtime.includes('confirmmapping')) {
    if (actionId === 'column_mapping') return true;
    if (actionId) return false;
    return /mapping|confirm/.test(stepName);
  }

  if (runtime.includes('normalize')) {
    if (actionId === 'normalize_to_staging') return true;
    if (actionId) return false;
    return /normalize|staging|diff|validate|validation|data\s*quality|duplicate|anomal/.test(
      stepName,
    );
  }

  if (runtime.includes('reviewchanges')) {
    if (actionId === 'publish_after_approval' || actionId === 'database_change_summary') {
      return true;
    }
    if (actionId) return false;
    return /review|readiness|impact|database|change\s*summary|publish/.test(stepName);
  }

  if (runtime.includes('detect')) {
    if (actionId === 'workbook_profiling') return true;
    if (actionId) return false;
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

function textDetailsFromPayload(payload: unknown): string[] {
  if (!isRenderableApprovalPayload(payload)) return [];
  const out: string[] = [];

  for (const detail of payload.details) {
    if (!detail || typeof detail !== 'object') continue;
    if ((detail as { kind?: unknown }).kind !== 'text') continue;

    const body = (detail as { body?: unknown }).body;
    if (typeof body !== 'string') continue;

    const lines = body
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);
    out.push(...lines);
  }

  return out;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseDataQualityReviewRows(payload: unknown): NormalizationReviewRow[] {
  if (!isRenderableApprovalPayload(payload)) return [];

  const rows: NormalizationReviewRow[] = [];
  for (const detail of payload.details) {
    if (!detail || typeof detail !== 'object') continue;
    if ((detail as { kind?: unknown }).kind !== 'dataQualityReview') continue;
    const rawRows = (detail as { rows?: unknown }).rows;
    if (!Array.isArray(rawRows)) continue;

    for (const rawRow of rawRows) {
      if (!rawRow || typeof rawRow !== 'object') continue;
      const row = rawRow as Record<string, unknown>;
      const id = asString(row.id);
      const groupId = asString(row.groupId);
      const groupLabel = asString(row.groupLabel);
      const tableId = asString(row.tableId);
      const sourceRow = asNumber(row.sourceRow);
      const status = asString(row.status);
      const issueType = asString(row.issueType);
      const issueLabel = asString(row.issueLabel);
      const issueDetail = asString(row.issueDetail) ?? '';
      const decision = asString(row.decision);
      if (
        !id ||
        !groupId ||
        !groupLabel ||
        !tableId ||
        !sourceRow ||
        !status ||
        !issueType ||
        !issueLabel
      ) {
        continue;
      }
      if (!['blocked', 'duplicate', 'warning', 'skipped'].includes(status)) continue;
      if (!['keep_row', 'skip_row', 'skipped'].includes(decision ?? '')) continue;

      const columns = Array.isArray(row.columns)
        ? row.columns
            .map((column) => {
              if (!column || typeof column !== 'object') return null;
              const key = asString((column as { key?: unknown }).key);
              const label = asString((column as { label?: unknown }).label);
              return key && label ? { key, label } : null;
            })
            .filter((column): column is NormalizationReviewColumn => Boolean(column))
        : [];

      const values =
        row.values && typeof row.values === 'object' ? (row.values as Record<string, unknown>) : {};
      const problemFields = Array.isArray(row.problemFields)
        ? row.problemFields.filter((field): field is string => typeof field === 'string')
        : [];

      rows.push({
        id,
        groupId,
        groupLabel,
        tableId,
        sourceSheet: asString(row.sourceSheet),
        sourceRow,
        status: status as NormalizationReviewRow['status'],
        issueType,
        issueLabel,
        issueDetail,
        values,
        columns,
        problemFields,
        duplicateGroupKey: asString(row.duplicateGroupKey),
        duplicateOfRowId: asString(row.duplicateOfRowId),
        decision: decision as NormalizationReviewRow['decision'],
        editable: row.editable === true,
      });
    }
  }

  return rows.sort((a, b) => {
    const tableCompare = a.tableId.localeCompare(b.tableId);
    if (tableCompare !== 0) return tableCompare;
    const groupCompare = a.groupLabel.localeCompare(b.groupLabel);
    if (groupCompare !== 0) return groupCompare;
    const duplicateCompare = (a.duplicateGroupKey ?? '').localeCompare(b.duplicateGroupKey ?? '');
    if (duplicateCompare !== 0) return duplicateCompare;
    return a.sourceRow - b.sourceRow;
  });
}

export function groupNormalizationRows(
  rows: NormalizationReviewRow[],
): NormalizationReviewTableGroup[] {
  const tableBuckets = new Map<string, NormalizationReviewRow[]>();
  for (const row of rows) {
    tableBuckets.set(row.tableId, [...(tableBuckets.get(row.tableId) ?? []), row]);
  }

  return [...tableBuckets.entries()].map(([tableId, tableRows]) => {
    const columns = tableRows.find((row) => row.columns.length > 0)?.columns ?? [];
    const issueBuckets = new Map<string, NormalizationReviewRow[]>();
    for (const row of tableRows) {
      issueBuckets.set(row.groupId, [...(issueBuckets.get(row.groupId) ?? []), row]);
    }
    const issueGroups = [...issueBuckets.entries()].map(([groupId, groupRows]) => ({
      groupId,
      groupLabel: groupRows[0]?.groupLabel ?? groupId,
      rows: groupRows,
    }));

    return {
      tableId,
      sourceSheet: tableRows[0]?.sourceSheet ?? null,
      columns,
      rows: tableRows,
      issueGroups,
      totals: {
        issues: tableRows.length,
        blocked: tableRows.filter((row) => row.status === 'blocked').length,
        duplicates: tableRows.filter((row) => row.status === 'duplicate').length,
        missingFields: tableRows.filter((row) => row.issueType === 'missing_required').length,
        missingRefs: tableRows.filter((row) => row.issueType === 'missing_reference').length,
        skipped: tableRows.filter((row) => row.status === 'skipped').length,
      },
    };
  });
}

function publishPrimaryApproves(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const primary = (payload as { primary?: unknown }).primary;
  if (!primary || typeof primary !== 'object') return false;
  const argsPatch = (primary as { argsPatch?: unknown }).argsPatch;
  if (!argsPatch || typeof argsPatch !== 'object') return false;
  return (argsPatch as { decision?: unknown }).decision === 'approve';
}

function willPublishFromPayload(payload: unknown, approval: WorkflowApprovalRow): boolean {
  if (payload && typeof payload === 'object') {
    const meta = (payload as { meta?: unknown }).meta;
    if (meta && typeof meta === 'object') {
      const willPublish = (meta as { willPublish?: unknown }).willPublish;
      if (typeof willPublish === 'boolean') return willPublish;
    }
  }

  const actionId = readActionIdFromApproval(approval);
  if (actionId === 'publish_after_approval') return true;
  if (actionId === 'database_change_summary') return false;

  if (isRenderableApprovalPayload(payload)) {
    const label = payload.primary.label.toLowerCase();
    if (label.includes('complete review')) return false;
    if (label.includes('approve publish')) return true;
  }

  const summary =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { summary?: unknown }).summary === 'string'
      ? (payload as { summary: string }).summary
      : null;
  if (summary && /no canonical pmo data will be written/i.test(summary)) return false;

  return actionId !== 'database_change_summary';
}

export function parsePublishReviewView(
  approval: WorkflowApprovalRow | null,
): PublishReviewViewModel | null {
  if (!approval || !isRenderableApprovalPayload(approval.proposedPayload)) return null;

  const payload = approval.proposedPayload as {
    summary?: unknown;
    primary: { label: string };
    decline?: { label?: unknown };
  };
  const tables = kvTablesFromPayload(payload);
  const summaryRows = tables[0] ?? [];
  const tableRows = tables[1] ?? [];
  const issueRows =
    tables
      .slice()
      .reverse()
      .find((table) =>
        table.some((row) =>
          /\brow\s+\d+\b|severity|error|required|missing|unresolved/i.test(`${row.k} ${row.v}`),
        ),
      ) ?? [];

  const summary = typeof payload.summary === 'string' ? payload.summary : 'Review publish changes.';
  const declineLabel =
    payload.decline && typeof payload.decline === 'object'
      ? (((payload.decline as { label?: unknown }).label as string | undefined) ?? null)
      : null;
  const willPublish = willPublishFromPayload(payload, approval);

  return {
    summary,
    primaryLabel: payload.primary.label,
    declineLabel,
    canApprove: publishPrimaryApproves(payload),
    willPublish,
    summaryRows,
    tableRows,
    issueRows,
    checklist: textDetailsFromPayload(payload),
  };
}

function missingMembersFromIssueRows(
  rows: Array<{ k: string; v: string }>,
): MissingMemberReference[] {
  const byMemberId = new Map<string, MissingMemberReference>();
  for (const row of rows) {
    if (!/\bmember_id\b/i.test(row.k)) continue;
    if (!/not found in member_master/i.test(row.v)) continue;

    const match = row.v.match(/'([^']+)'/);
    const memberId = match?.[1]?.trim();
    if (!memberId) continue;

    const existing = byMemberId.get(memberId);
    if (existing) {
      byMemberId.set(memberId, {
        ...existing,
        source: `${existing.source}; ${row.k}`,
      });
      continue;
    }

    byMemberId.set(memberId, {
      memberId,
      source: row.k,
      reason: row.v,
    });
  }

  return [...byMemberId.values()];
}

export function parseNormalizationReviewView(
  approval: WorkflowApprovalRow | null,
): NormalizationReviewViewModel | null {
  const base = parsePublishReviewView(approval);
  if (!base) return null;
  const reviewRows = parseDataQualityReviewRows(approval?.proposedPayload);

  return {
    ...base,
    canApprove: base.primaryLabel === 'Approve normalization' && base.canApprove,
    missingMembers: missingMembersFromIssueRows(base.issueRows),
    reviewRows,
    tableGroups: groupNormalizationRows(reviewRows),
  };
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

function inferActionIdFromStepName(stepName: string): PmoPlanActionId {
  const normalized = stepName.toLowerCase();
  if (/report|utili[sz]ation|overbook|idle/.test(normalized)) {
    return 'generate_report';
  }
  if (/publish|final\s*approval|upsert|write\s+target/.test(normalized)) {
    return 'publish_after_approval';
  }
  if (
    /normaliz|staging|clean|transform|validate|validation|data\s*quality|duplicate|anomal/.test(
      normalized,
    )
  ) {
    return 'normalize_to_staging';
  }
  if (/column|field|mapping|map\s+proposal|schema\s+align|reconcile/.test(normalized)) {
    return 'column_mapping';
  }
  if (/database|db\s+change|change\s*summary|comparison|diff|impact|readiness/.test(normalized)) {
    return 'database_change_summary';
  }
  if (/workbook|profil|detect|sheet\s+role|parse/.test(normalized)) {
    return 'workbook_profiling';
  }
  return 'generic_review';
}

function reviewTypeForActionId(actionId: string | undefined): PmoReviewType {
  if (actionId === 'workbook_profiling') return 'profiling';
  if (actionId === 'column_mapping') return 'mapping';
  if (actionId === 'normalize_to_staging') return 'normalization';
  if (actionId === 'database_change_summary' || actionId === 'publish_after_approval') {
    return 'publish';
  }
  if (actionId === 'generate_report') return 'report';
  return 'generic';
}

function findStepViewState(
  session: PmoPlanningSession,
  step: {
    action_id?: string;
    planner_step_id?: string;
    step_no?: number;
  },
): PmoStepViewState | undefined {
  const views = session.execution_state?.step_views;
  if (!views) return undefined;

  if (step.action_id && views[step.action_id]) return views[step.action_id];

  return Object.values(views).find((view) => {
    if (step.planner_step_id && view.planner_step_id === step.planner_step_id) return true;
    if (step.action_id && view.action_id === step.action_id) return true;
    return false;
  });
}

export function buildExecutionCards(session: PmoPlanningSession | null): ExecutionCard[] {
  if (!session) {
    return [];
  }

  // When plan is null (e.g. agent hasn't written it yet), fall back to execution_state.steps.
  if (!session.plan) {
    if (session.execution_state?.steps?.length) {
      return session.execution_state.steps
        .slice()
        .sort((a, b) => a.step_no - b.step_no)
        .map((step) => ({
          step_no: step.step_no,
          planner_step_id: step.planner_step_id,
          action_id: step.action_id,
          review_type: step.review_type,
          step_name: step.step_name,
          status: step.status,
          description: '',
          output_summary: step.output_summary ?? findStepViewState(session, step)?.output_summary,
          view_state: findStepViewState(session, step),
        }));
    }
    return [];
  }

  const sortedWorkflow = session.plan.proposed_workflow
    .slice()
    .sort((a, b) => a.step_no - b.step_no);

  if (sortedWorkflow.length > 0) {
    const statusByStepNo = new Map<number, PmoWorkflowExecutionStepStatus>();
    for (const step of session.execution_state?.steps ?? []) {
      statusByStepNo.set(step.step_no, step.status);
    }

    const cards = sortedWorkflow.map((step, index) => {
      const actionId = step.action_id ?? inferActionIdFromStepName(step.step_name);
      const runtimeStep = session.execution_state?.steps.find(
        (item) => item.step_no === step.step_no,
      );
      const viewState = findStepViewState(session, {
        action_id: actionId,
        planner_step_id: step.planner_step_id,
        step_no: step.step_no,
      });
      return {
        step_no: step.step_no,
        planner_step_id: step.planner_step_id ?? `pmo.planner.step.${step.step_no}.${actionId}`,
        action_id: actionId,
        review_type: step.review_type ?? reviewTypeForActionId(actionId),
        step_name: step.step_name,
        status:
          statusByStepNo.get(step.step_no) ??
          (session.planning_state === 'approved_plan' && index === 0 ? 'in_progress' : 'pending'),
        description: step.description,
        output_summary: runtimeStep?.output_summary ?? viewState?.output_summary,
        view_state: viewState,
      };
    });

    // Keep unexpected runtime-only steps visible for observability if they exist.
    const plannerStepNos = new Set(cards.map((step) => step.step_no));
    const runtimeOnlySteps = (session.execution_state?.steps ?? [])
      .filter((step) => !plannerStepNos.has(step.step_no))
      .sort((a, b) => a.step_no - b.step_no)
      .map((step) => ({
        step_no: step.step_no,
        planner_step_id: step.planner_step_id,
        action_id: step.action_id,
        review_type: step.review_type,
        step_name: step.step_name,
        status: step.status,
        description: '',
        output_summary: step.output_summary ?? findStepViewState(session, step)?.output_summary,
        view_state: findStepViewState(session, step),
      }));

    return [...cards, ...runtimeOnlySteps].sort((a, b) => a.step_no - b.step_no);
  }

  if (session.execution_state?.steps?.length) {
    return session.execution_state.steps
      .slice()
      .sort((a, b) => a.step_no - b.step_no)
      .map((step) => ({
        step_no: step.step_no,
        planner_step_id: step.planner_step_id,
        action_id: step.action_id,
        review_type: step.review_type,
        step_name: step.step_name,
        status: step.status,
        description: '',
        output_summary: step.output_summary ?? findStepViewState(session, step)?.output_summary,
        view_state: findStepViewState(session, step),
      }));
  }

  if (sortedWorkflow.length === 0) {
    return [
      {
        step_no: 1,
        planner_step_id: 'pmo.planner.step.1.workbook_profiling',
        action_id: 'workbook_profiling',
        review_type: 'profiling',
        step_name: 'Workbook Profiling',
        status: session.planning_state === 'approved_plan' ? 'in_progress' : 'pending',
      },
    ];
  }

  return sortedWorkflow.map((step, index) => {
    const actionId = step.action_id ?? inferActionIdFromStepName(step.step_name);
    return {
      step_no: step.step_no,
      planner_step_id: step.planner_step_id ?? `pmo.planner.step.${step.step_no}.${actionId}`,
      action_id: actionId,
      review_type: step.review_type ?? reviewTypeForActionId(actionId),
      step_name: step.step_name,
      status:
        session.planning_state === 'approved_plan'
          ? index === 0
            ? 'in_progress'
            : 'pending'
          : 'pending',
      description: step.description,
      view_state: findStepViewState(session, {
        action_id: actionId,
        planner_step_id: step.planner_step_id,
        step_no: step.step_no,
      }),
    };
  });
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
