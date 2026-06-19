import type { ApprovalCard } from '@seta/agent-sdk';
import type { z } from 'zod';
import type { PmoPlannerStepMetadata } from '../../planning/step-metadata.ts';
import type { DetectOutputSchema, StagingOutputSchema } from './schemas.ts';

type TableMapping = z.infer<typeof DetectOutputSchema>['tableMappings'][number];
type ChangeSummaryTable = z.infer<typeof StagingOutputSchema>['changeSummary'][number];
type BlockingIssue = z.infer<typeof StagingOutputSchema>['blockingIssues'][number];

interface CardIdentity {
  tenantId: string;
  userId: string;
}

interface MappingCardInput {
  ingestionSessionId: string;
  workbookConfidence: number;
  validationStatus: 'confirmed' | 'needs_review' | 'blocked';
  tableMappings: TableMapping[];
  allowApprove: boolean;
  identity: CardIdentity;
  toolCallId: string;
  plannerStep?: PmoPlannerStepMetadata | null;
}

export interface MappingCandidateOption {
  sourceColumn: string;
  confidence: number;
  blocked: boolean;
}

export interface MappingOverride {
  tableId: string;
  field: string;
  sourceColumn: string;
  confidence?: number;
  blocked?: boolean;
}

export interface MappingReviewItem {
  id: string;
  tableId: string;
  sourceSheet: string;
  field: string;
  issueType: 'needs_review' | 'blocked' | 'required_missing' | 'ambiguous';
  sourceColumn?: string;
  confidence?: number;
  candidates: MappingCandidateOption[];
  note: string;
}

export interface MappingDisplayItem {
  tableId: string;
  sourceSheet: string;
  field: string;
  issueType: MappingReviewItem['issueType'] | 'auto_accept';
  sourceColumn?: string;
  confidence?: number;
  candidates: MappingCandidateOption[];
  reviewItemId: string | null;
}

interface MappingItemCardInput {
  ingestionSessionId: string;
  workbookConfidence: number;
  validationStatus: 'confirmed' | 'needs_review' | 'blocked';
  tableMappings: TableMapping[];
  reviewItems: MappingReviewItem[];
  approvedItemIds: string[];
  approvedByByItemKey: Record<string, string>;
  mappingOverrides: MappingOverride[];
  currentItemId: string;
  awaitingNextStep?: boolean;
  identity: CardIdentity;
  toolCallId: string;
  plannerStep?: PmoPlannerStepMetadata | null;
}

interface PublishCardInput {
  ingestionSessionId: string;
  changeSummary: ChangeSummaryTable[];
  blockingIssues: BlockingIssue[];
  mappingReviewRows?: KvRow[];
  allowApprove: boolean;
  identity: CardIdentity;
  toolCallId: string;
  plannerStep?: PmoPlannerStepMetadata | null;
}

interface NormalizationCardInput {
  ingestionSessionId: string;
  changeSummary: ChangeSummaryTable[];
  blockingIssues: BlockingIssue[];
  reviewRows?: NormalizationReviewCardRow[];
  allowApprove: boolean;
  identity: CardIdentity;
  toolCallId: string;
  plannerStep?: PmoPlannerStepMetadata | null;
}

interface ReportRangeCardInput {
  ingestionSessionId: string;
  suggestedDateRange: { from: string; to: string };
  databaseDateBounds: { min: string; max: string };
  rangeSource: 'database' | 'sheet_or_database';
  reportTypes: Array<'idle_members' | 'overbook_members'>;
  identity: CardIdentity;
  toolCallId: string;
  plannerStep?: PmoPlannerStepMetadata | null;
}

interface NormalizationReviewCardColumn {
  key: string;
  label: string;
}

interface NormalizationReviewCardRow {
  id: string;
  groupId: string;
  groupLabel: string;
  tableId: string;
  sourceSheet?: string;
  sourceRow: number;
  status: 'blocked' | 'duplicate' | 'warning' | 'skipped';
  issueType: string;
  issueLabel: string;
  issueDetail: string;
  values: Record<string, unknown>;
  columns: NormalizationReviewCardColumn[];
  problemFields: string[];
  duplicateGroupKey?: string;
  duplicateOfRowId?: string;
  decision: 'keep_row' | 'skip_row' | 'skipped';
  editable?: boolean;
}

interface KvRow {
  k: string;
  v: string;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mappingRows(tableMappings: TableMapping[]): Array<{ k: string; v: string }> {
  return tableMappings.map((t) => {
    let autoAccept = 0;
    let needsReview = 0;
    let blocked = 0;

    for (const m of t.mappings) {
      if (m.status === 'auto_accept') autoAccept++;
      else if (m.status === 'needs_review') needsReview++;
      else blocked++;
    }

    const parts = [
      `sheet=${t.sourceSheet}`,
      `auto=${autoAccept}`,
      `review=${needsReview}`,
      `blocked=${blocked}`,
      `required_missing=${t.unmappedRequired.length}`,
      `table_conf=${percent(t.tableConfidence)}`,
    ];

    return { k: t.tableId, v: parts.join(' | ') };
  });
}

function mappingIssueRows(tableMappings: TableMapping[]): KvRow[] {
  const rows: KvRow[] = [];

  for (const table of tableMappings) {
    for (const mapping of table.mappings) {
      if (mapping.status === 'auto_accept') continue;
      rows.push({
        k: `${table.tableId}.${mapping.canonicalField}`,
        v: `${mapping.status} <- ${mapping.sourceColumn} (${percent(mapping.confidence)})`,
      });
    }

    for (const field of table.unmappedRequired) {
      rows.push({
        k: `${table.tableId}.${field}`,
        v: 'required field has no mapped source column',
      });
    }

    for (const field of table.ambiguous) {
      rows.push({
        k: `${table.tableId}.${field}`,
        v: 'ambiguous mapping candidates',
      });
    }
  }

  return capRows(rows, 24);
}

function reviewItemKey(item: Pick<MappingReviewItem, 'tableId' | 'field'>): string {
  return `${item.tableId}|${item.field}`;
}

function issuePriority(issueType: MappingReviewItem['issueType']): number {
  switch (issueType) {
    case 'required_missing':
      return 4;
    case 'blocked':
      return 3;
    case 'ambiguous':
      return 2;
    case 'needs_review':
      return 1;
  }
}

function mergeCandidates(
  existing: MappingCandidateOption[],
  incoming: MappingCandidateOption[],
): MappingCandidateOption[] {
  const merged = new Map<string, MappingCandidateOption>();
  for (const candidate of [...existing, ...incoming]) {
    const previous = merged.get(candidate.sourceColumn);
    if (!previous || candidate.confidence > previous.confidence) {
      merged.set(candidate.sourceColumn, candidate);
    }
  }
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}

function mappingOverrideKey(item: Pick<MappingOverride, 'tableId' | 'field'>): string {
  return `${item.tableId}|${item.field}`;
}

function upsertMappingOverride(
  overrides: MappingOverride[],
  incoming: MappingOverride,
): MappingOverride[] {
  const key = mappingOverrideKey(incoming);
  const out = overrides.filter((entry) => mappingOverrideKey(entry) !== key);
  out.push(incoming);
  return out;
}

function mergeMappingOverrides(overrides: MappingOverride[]): MappingOverride[] {
  const byKey = new Map<string, MappingOverride>();
  for (const override of overrides) {
    byKey.set(mappingOverrideKey(override), override);
  }
  return [...byKey.values()];
}

interface BuildMappingReviewRowsInput {
  displayItems: MappingDisplayItem[];
  reviewItems: MappingReviewItem[];
  approvedItemIds: string[];
  approvedByByItemKey: Record<string, string>;
  fallbackApprovedBy: string;
  currentItemId: string | null;
  awaitingNextStep?: boolean;
}

export function buildMappingReviewRows(input: BuildMappingReviewRowsInput): KvRow[] {
  const approvedSet = new Set(input.approvedItemIds);
  const reviewByKey = new Map<string, MappingReviewItem>();
  for (const reviewItem of input.reviewItems) {
    reviewByKey.set(reviewItemKey(reviewItem), reviewItem);
  }

  return input.displayItems.map((item) => {
    const reviewItem = reviewByKey.get(reviewItemKey(item));
    const reviewItemId = reviewItem?.id ?? item.reviewItemId;
    const isReviewItem = reviewItemId !== null;
    const isApproved = isReviewItem ? approvedSet.has(reviewItemId) : true;
    const isCurrent =
      !input.awaitingNextStep &&
      isReviewItem &&
      !isApproved &&
      input.currentItemId !== null &&
      reviewItemId === input.currentItemId;
    const state = isApproved ? 'approved' : isCurrent ? 'current review' : 'pending review';
    const sourceColumn = item.sourceColumn ?? '-';
    const confidence = typeof item.confidence === 'number' ? percent(item.confidence) : '-';
    const approvedBy =
      isReviewItem && isApproved
        ? (input.approvedByByItemKey[reviewItemId] ?? input.fallbackApprovedBy)
        : '-';
    const actionType = isReviewItem ? 'approve_and_modify' : 'modify_only';

    return {
      k: `${item.tableId}.${item.field}`,
      v: `${state} | ${item.issueType} | ${sourceColumn} | ${confidence} | ${approvedBy} | ${item.sourceSheet} | ${actionType}`,
    };
  });
}

function mergeReviewItem(
  existing: MappingReviewItem,
  incoming: MappingReviewItem,
): MappingReviewItem {
  if (existing.issueType === 'ambiguous' || incoming.issueType === 'ambiguous') {
    const sourceColumn = existing.sourceColumn ?? incoming.sourceColumn;
    const confidence = existing.confidence ?? incoming.confidence;
    const sourceDetail =
      sourceColumn !== undefined
        ? `; current candidate ${sourceColumn}${typeof confidence === 'number' ? ` (${percent(confidence)})` : ''}`
        : '';

    return {
      ...existing,
      issueType: 'ambiguous',
      sourceColumn,
      confidence,
      candidates: mergeCandidates(existing.candidates, incoming.candidates),
      note: `ambiguous mapping candidates${sourceDetail}`,
    };
  }

  const dominant =
    issuePriority(incoming.issueType) > issuePriority(existing.issueType) ? incoming : existing;

  return {
    ...existing,
    issueType: dominant.issueType,
    sourceColumn: existing.sourceColumn ?? incoming.sourceColumn,
    confidence: existing.confidence ?? incoming.confidence,
    candidates: mergeCandidates(existing.candidates, incoming.candidates),
    note: dominant.note,
  };
}

export function collectMappingReviewItems(tableMappings: TableMapping[]): MappingReviewItem[] {
  const out: MappingReviewItem[] = [];
  const indexByKey = new Map<string, number>();

  const pushOrMerge = (item: MappingReviewItem): void => {
    const key = reviewItemKey(item);
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, out.length);
      out.push(item);
      return;
    }

    const existing = out[existingIndex];
    if (!existing) return;
    out[existingIndex] = mergeReviewItem(existing, item);
  };

  for (const table of tableMappings) {
    for (const mapping of table.mappings) {
      if (mapping.status === 'auto_accept') continue;
      pushOrMerge({
        id: `${table.tableId}|mapping|${mapping.canonicalField}|${mapping.sourceColumn}|${mapping.status}`,
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field: mapping.canonicalField,
        issueType: mapping.status,
        sourceColumn: mapping.sourceColumn,
        confidence: mapping.confidence,
        candidates: [...(mapping.candidates ?? [])].sort((a, b) => b.confidence - a.confidence),
        note: `${mapping.status} <- ${mapping.sourceColumn} (${percent(mapping.confidence)})`,
      });
    }

    for (const field of table.unmappedRequired) {
      pushOrMerge({
        id: `${table.tableId}|required_missing|${field}`,
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field,
        issueType: 'required_missing',
        candidates: [],
        note: 'required field has no mapped source column',
      });
    }

    for (const field of table.ambiguous) {
      pushOrMerge({
        id: `${table.tableId}|ambiguous|${field}`,
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field,
        issueType: 'ambiguous',
        candidates: [],
        note: 'ambiguous mapping candidates',
      });
    }
  }

  return out;
}

function compareDisplayItems(a: MappingDisplayItem, b: MappingDisplayItem): number {
  if (a.sourceSheet !== b.sourceSheet) return a.sourceSheet.localeCompare(b.sourceSheet);
  if (a.tableId !== b.tableId) return a.tableId.localeCompare(b.tableId);
  return a.field.localeCompare(b.field);
}

function reviewItemToDisplayItem(item: MappingReviewItem): MappingDisplayItem {
  return {
    tableId: item.tableId,
    sourceSheet: item.sourceSheet,
    field: item.field,
    issueType: item.issueType,
    sourceColumn: item.sourceColumn,
    confidence: item.confidence,
    candidates: item.candidates,
    reviewItemId: item.id,
  };
}

export function collectMappingDisplayItems(
  tableMappings: TableMapping[],
  reviewItems: MappingReviewItem[],
): MappingDisplayItem[] {
  const reviewByKey = new Map<string, MappingReviewItem>();
  for (const reviewItem of reviewItems) {
    reviewByKey.set(reviewItemKey(reviewItem), reviewItem);
  }

  const out: MappingDisplayItem[] = [];
  const seenKeys = new Set<string>();

  for (const table of tableMappings) {
    for (const mapping of table.mappings) {
      const key = reviewItemKey({ tableId: table.tableId, field: mapping.canonicalField });
      if (seenKeys.has(key)) continue;

      const mergedReviewItem = reviewByKey.get(key);
      if (mergedReviewItem) {
        seenKeys.add(key);
        out.push(reviewItemToDisplayItem(mergedReviewItem));
        continue;
      }

      seenKeys.add(key);
      out.push({
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field: mapping.canonicalField,
        issueType: 'auto_accept',
        sourceColumn: mapping.sourceColumn,
        confidence: mapping.confidence,
        candidates: [...(mapping.candidates ?? [])].sort((a, b) => b.confidence - a.confidence),
        reviewItemId: null,
      });
    }
  }

  for (const reviewItem of reviewItems) {
    const key = reviewItemKey(reviewItem);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(reviewItemToDisplayItem(reviewItem));
  }

  return out.sort(compareDisplayItems);
}

export function buildMappingItemReviewCard(input: MappingItemCardInput): ApprovalCard {
  const totalItems = input.reviewItems.length;
  const safeApproved = input.approvedItemIds.filter((id) =>
    input.reviewItems.some((item) => item.id === id),
  );
  const safeApprovedByByItemKey: Record<string, string> = {};
  for (const itemId of safeApproved) {
    const approver = input.approvedByByItemKey[itemId];
    if (approver) safeApprovedByByItemKey[itemId] = approver;
  }
  const awaitingNextStep = input.awaitingNextStep === true;
  const currentItem =
    input.reviewItems.find((item) => item.id === input.currentItemId) ?? input.reviewItems[0];

  if (!currentItem) {
    throw new Error('mapping_review_items_empty');
  }

  const approvedCount = safeApproved.length;
  const itemOrdinal = Math.min(approvedCount + 1, Math.max(totalItems, 1));
  const safeOverrides = mergeMappingOverrides(input.mappingOverrides);
  const displayItems = collectMappingDisplayItems(input.tableMappings, input.reviewItems);
  const summary = awaitingNextStep
    ? 'All mapping items are approved. Click Next step to continue to DB changes review.'
    : `Review mapping item ${itemOrdinal}/${totalItems}. Approve each item to continue.`;
  const alternates = awaitingNextStep
    ? []
    : displayItems.flatMap((item) => {
        const candidates = item.candidates.filter(
          (candidate) => candidate.sourceColumn !== item.sourceColumn,
        );

        return candidates.map((candidate) => {
          const override: MappingOverride = {
            tableId: item.tableId,
            field: item.field,
            sourceColumn: candidate.sourceColumn,
            confidence: candidate.confidence,
            blocked: candidate.blocked,
          };

          return {
            label: `Use ${item.sourceSheet}.${candidate.sourceColumn} for ${item.tableId}.${item.field}${candidate.blocked ? ' (blocked)' : ''}`,
            argsPatch: {
              decision: 'modify' as const,
              approvedItemKeys: safeApproved,
              approvedByByItemKey: safeApprovedByByItemKey,
              mappingOverride: override,
              mappingOverrides: upsertMappingOverride(safeOverrides, override),
            },
          };
        });
      });

  const candidateItems = awaitingNextStep
    ? []
    : currentItem.candidates.map((candidate) => ({
        id: `${currentItem.tableId}|${currentItem.field}|${candidate.sourceColumn}`,
        label: candidate.sourceColumn,
        secondary: candidate.blocked
          ? `confidence ${percent(candidate.confidence)} • blocked by data type`
          : `confidence ${percent(candidate.confidence)}`,
        score: candidate.confidence,
      }));

  const reviewProgressRows = capRows(
    buildMappingReviewRows({
      displayItems,
      reviewItems: input.reviewItems,
      approvedItemIds: safeApproved,
      approvedByByItemKey: safeApprovedByByItemKey,
      fallbackApprovedBy: input.identity.userId,
      currentItemId: currentItem.id,
      awaitingNextStep,
    }),
    200,
  );

  return {
    toolCallId: input.toolCallId,
    intent: awaitingNextStep ? 'Proceed to DB changes review' : 'Approve mapping item',
    riskBadge: 'write',
    summary,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'Validation status', v: input.validationStatus },
          { k: 'Workbook confidence', v: percent(input.workbookConfidence) },
          { k: 'Approved items', v: `${approvedCount}/${totalItems}` },
        ],
      },
      {
        kind: 'kvTable',
        rows: awaitingNextStep
          ? [
              { k: 'Status', v: 'All mapping items are approved' },
              { k: 'Next action', v: 'Click Next step to continue workflow' },
            ]
          : [
              { k: 'Issue type', v: currentItem.issueType },
              { k: 'Table', v: currentItem.tableId },
              { k: 'Sheet', v: currentItem.sourceSheet },
              { k: 'Field', v: currentItem.field },
              ...(currentItem.sourceColumn
                ? [{ k: 'Source column', v: currentItem.sourceColumn }]
                : []),
              ...(typeof currentItem.confidence === 'number'
                ? [{ k: 'Confidence', v: percent(currentItem.confidence) }]
                : []),
              { k: 'Issue', v: currentItem.note },
            ],
      },
      {
        kind: 'text',
        body: checklistMarkdown(
          awaitingNextStep
            ? [
                'Review the approved mapping history below.',
                'Click Next step to continue to DB changes review.',
                'Use Reject upload if you want to abort this workflow run.',
              ]
            : [
                'Approve this item if the mapping is acceptable.',
                'Use Modify to switch the source column directly in this PMO tab.',
                'Reject upload if this mapping issue should not proceed.',
                'The workflow continues only after all mapping items are approved.',
              ],
        ),
      },
      ...(candidateItems.length > 0
        ? [
            {
              kind: 'candidateList' as const,
              items: candidateItems,
            },
          ]
        : []),
      {
        kind: 'kvTable',
        rows: reviewProgressRows,
      },
    ],
    primary: {
      label: awaitingNextStep ? 'Next step' : `Approve item ${itemOrdinal}/${totalItems}`,
      argsPatch: {
        decision: 'approve',
        approvedItemKeys: safeApproved,
        approvedByByItemKey: safeApprovedByByItemKey,
        mappingOverrides: safeOverrides,
        ...(awaitingNextStep ? { proceedToNextStep: true } : { approvedItemKey: currentItem.id }),
      },
    },
    alternates,
    decline: {
      label: 'Reject upload',
      argsPatch: {
        decision: 'reject',
        approvedItemKeys: safeApproved,
        approvedByByItemKey: safeApprovedByByItemKey,
        mappingOverrides: safeOverrides,
      },
    },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmMapping',
      ...plannerStepMeta(input.plannerStep),
      ts: new Date().toISOString(),
    },
  };
}

function publishRows(changeSummary: ChangeSummaryTable[]): Array<{ k: string; v: string }> {
  return changeSummary.map((t) => {
    const c = t.counts;
    const publishRowsCount = c.new_records + c.updated_records;
    return {
      k: t.tableId,
      v: `publish=${publishRowsCount} | skip_existing=${c.exact_duplicates} | new=${c.new_records} | overwrite=${c.updated_records}`,
    };
  });
}

function publishSampleRows(changeSummary: ChangeSummaryTable[]): KvRow[] {
  const rows: KvRow[] = [];

  for (const table of changeSummary) {
    for (const change of table.sampleChanges) {
      const naturalKey = Object.entries(change.naturalKey)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      rows.push({
        k: `${table.tableId}.${change.type}`,
        v: naturalKey || 'no natural key details',
      });
    }
  }

  return capRows(rows, 20);
}

function blockingIssueRows(blockingIssues: BlockingIssue[]): KvRow[] {
  return capRows(
    blockingIssues.map((issue) => ({
      k: `${issue.tableId} row ${issue.sourceRow} ${issue.field}`,
      v: issue.reason,
    })),
    20,
  );
}

function reviewColumnsForBlock(
  rows: NormalizationReviewCardRow[],
): NormalizationReviewCardColumn[] {
  const byKey = new Map<string, NormalizationReviewCardColumn>();
  for (const row of rows) {
    for (const column of row.columns) {
      if (!byKey.has(column.key)) byKey.set(column.key, column);
    }
  }
  return [...byKey.values()].slice(0, 16);
}

function checklistMarkdown(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function capRows(rows: KvRow[], maxRows: number): KvRow[] {
  if (rows.length <= maxRows) return rows;
  return [
    ...rows.slice(0, maxRows),
    { k: 'more', v: `${rows.length - maxRows} additional item(s) not shown` },
  ];
}

function plannerStepMeta(step: PmoPlannerStepMetadata | null | undefined): {
  plannerStepId?: string;
  actionId?: string;
  reviewType?: string;
} {
  if (!step) return {};
  return {
    plannerStepId: step.planner_step_id,
    actionId: step.action_id,
    reviewType: step.review_type,
  };
}

export function buildMappingReviewCard(input: MappingCardInput): ApprovalCard {
  const blockedTables = input.tableMappings.filter((t) =>
    t.mappings.some((m) => m.status === 'blocked'),
  ).length;
  const needsReviewTables = input.tableMappings.filter((t) =>
    t.mappings.some((m) => m.status === 'needs_review'),
  ).length;

  const summary = input.allowApprove
    ? `Detected ${input.tableMappings.length} table(s). ${needsReviewTables} table(s) need review before normalization.`
    : `Detected blocked mappings in ${blockedTables} table(s). Approval is disabled for this run.`;

  const checklist = input.allowApprove
    ? [
        'Headers map to expected canonical fields.',
        'Any ambiguous columns are acceptable for this reporting period.',
        'Proceed to normalization and staging.',
      ]
    : [
        'At least one required mapping is blocked.',
        'Reject this run and correct workbook headers before retrying.',
      ];
  const issueRows = mappingIssueRows(input.tableMappings);

  return {
    toolCallId: input.toolCallId,
    intent: 'Confirm workbook mapping before normalization',
    riskBadge: 'write',
    summary,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'Validation status', v: input.validationStatus },
          { k: 'Workbook confidence', v: percent(input.workbookConfidence) },
        ],
      },
      {
        kind: 'kvTable',
        rows: mappingRows(input.tableMappings),
      },
      ...(issueRows.length > 0
        ? [
            {
              kind: 'kvTable' as const,
              rows: issueRows,
            },
          ]
        : []),
      {
        kind: 'text',
        body: checklistMarkdown(checklist),
      },
    ],
    primary: input.allowApprove
      ? {
          label: 'Approve mapping',
          argsPatch: { decision: 'approve' },
        }
      : {
          label: 'Reject blocked mapping',
          argsPatch: { decision: 'reject' },
        },
    alternates: [],
    decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmMapping',
      ...plannerStepMeta(input.plannerStep),
      ts: new Date().toISOString(),
    },
  };
}

export function buildPublishReviewCard(input: PublishCardInput): ApprovalCard {
  const totals = input.changeSummary.reduce(
    (acc, t) => {
      acc.newRecords += t.counts.new_records;
      acc.updatedRecords += t.counts.updated_records;
      acc.exactDuplicates += t.counts.exact_duplicates;
      return acc;
    },
    {
      newRecords: 0,
      updatedRecords: 0,
      exactDuplicates: 0,
    },
  );

  const summary = input.allowApprove
    ? `Ready to publish ${totals.newRecords + totals.updatedRecords} change(s). ${totals.exactDuplicates} unchanged row(s) will be skipped.`
    : [
        input.blockingIssues.length > 0
          ? `Found ${input.blockingIssues.length} blocking data issue(s).`
          : null,
        'Publish approval is disabled until issues are resolved.',
      ]
        .filter(Boolean)
        .join(' ');

  const checklist = input.allowApprove
    ? [
        'New rows will be inserted.',
        'Updated rows will overwrite existing PMO records with the same business key.',
        'Unchanged rows already present in PMO data will be skipped.',
      ]
    : [
        'Rows with parse/required errors must be corrected in the workbook.',
        'Reject this run and fix blocking rows before retrying.',
      ];
  const sampleRows = publishSampleRows(input.changeSummary);
  const issueRows = blockingIssueRows(input.blockingIssues);
  const mappingReviewRows = capRows(input.mappingReviewRows ?? [], 40);

  return {
    toolCallId: input.toolCallId,
    intent: 'Review staging changes before publish',
    riskBadge: 'write',
    summary,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'Rows to publish', v: String(totals.newRecords + totals.updatedRecords) },
          { k: 'Rows to skip', v: String(totals.exactDuplicates) },
          { k: 'New rows', v: String(totals.newRecords) },
          { k: 'Rows to overwrite', v: String(totals.updatedRecords) },
          { k: 'Skip reason', v: 'Already exists with no changes' },
          { k: 'Blocking issues', v: String(input.blockingIssues.length) },
        ],
      },
      {
        kind: 'kvTable',
        rows: publishRows(input.changeSummary),
      },
      ...(sampleRows.length > 0
        ? [
            {
              kind: 'kvTable' as const,
              rows: sampleRows,
            },
          ]
        : []),
      ...(issueRows.length > 0
        ? [
            {
              kind: 'kvTable' as const,
              rows: issueRows,
            },
          ]
        : []),
      ...(mappingReviewRows.length > 0
        ? [
            {
              kind: 'kvTable' as const,
              rows: mappingReviewRows,
            },
          ]
        : []),
      {
        kind: 'text',
        body: checklistMarkdown(checklist),
      },
    ],
    primary: input.allowApprove
      ? {
          label: 'Approve publish',
          argsPatch: { decision: 'approve' },
        }
      : {
          label: 'Reject blocked publish',
          argsPatch: { decision: 'reject' },
        },
    alternates: [],
    decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmPublish',
      ...plannerStepMeta(input.plannerStep),
      ts: new Date().toISOString(),
    },
  };
}

export function buildNormalizationReviewCard(input: NormalizationCardInput): ApprovalCard {
  const totals = input.changeSummary.reduce(
    (acc, t) => {
      acc.newRecords += t.counts.new_records;
      acc.updatedRecords += t.counts.updated_records;
      acc.exactDuplicates += t.counts.exact_duplicates;
      acc.duplicatesInUpload += t.counts.duplicates_in_upload;
      return acc;
    },
    {
      newRecords: 0,
      updatedRecords: 0,
      exactDuplicates: 0,
      duplicatesInUpload: 0,
    },
  );

  const unresolvedReferenceCount = input.blockingIssues.filter((issue) =>
    issue.reason.includes('unresolved reference'),
  ).length;
  const missingRequiredCount = input.blockingIssues.filter((issue) =>
    issue.reason.includes('required value missing'),
  ).length;
  const parseErrorCount =
    input.blockingIssues.length - unresolvedReferenceCount - missingRequiredCount;

  const summary = input.allowApprove
    ? `Normalized data is ready for staging review. Found ${totals.duplicatesInUpload} duplicate-in-upload row(s) and ${input.blockingIssues.length} blocking issue(s).`
    : [
        input.blockingIssues.length > 0
          ? `Found ${input.blockingIssues.length} blocking normalization issue(s).`
          : null,
        totals.duplicatesInUpload > 0
          ? `Found ${totals.duplicatesInUpload} duplicate-in-upload row(s).`
          : null,
        'Resolve these before staging can continue.',
      ]
        .filter(Boolean)
        .join(' ');

  const checklist = input.allowApprove
    ? [
        'Normalized values are parseable and required fields are present.',
        'Master data references exist in the workbook master sheets or current database.',
        'Proceed to stage normalized data for downstream review.',
      ]
    : [
        'Add missing master data rows or correct workbook references.',
        'Resolve duplicate-in-upload rows for tables where duplicates are blocked.',
        'Reject this run if the source workbook needs to be corrected offline.',
      ];

  return {
    toolCallId: input.toolCallId,
    intent: 'Review normalized data quality before staging',
    riskBadge: 'write',
    summary,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'Rows to stage', v: String(totals.newRecords + totals.updatedRecords) },
          { k: 'Rows unchanged', v: String(totals.exactDuplicates) },
          { k: 'Duplicates in upload', v: String(totals.duplicatesInUpload) },
          { k: 'Blocking issues', v: String(input.blockingIssues.length) },
          { k: 'Unresolved references', v: String(unresolvedReferenceCount) },
          { k: 'Missing required values', v: String(missingRequiredCount) },
          { k: 'Parse errors', v: String(Math.max(parseErrorCount, 0)) },
        ],
      },
      {
        kind: 'kvTable',
        rows: publishRows(input.changeSummary),
      },
      ...(input.blockingIssues.length > 0
        ? [
            {
              kind: 'kvTable' as const,
              rows: blockingIssueRows(input.blockingIssues),
            },
          ]
        : []),
      ...(input.reviewRows?.length
        ? [
            {
              kind: 'dataQualityReview' as const,
              columns: reviewColumnsForBlock(input.reviewRows),
              rows: input.reviewRows,
            },
          ]
        : []),
      {
        kind: 'text',
        body: checklistMarkdown(checklist),
      },
    ],
    primary: input.allowApprove
      ? {
          label: 'Approve normalization',
          argsPatch: { decision: 'approve' },
        }
      : {
          label: 'Submit normalization review',
          argsPatch: { decision: 'approve' },
        },
    alternates: [],
    decline: { label: 'Reject normalization', argsPatch: { decision: 'reject' } },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_reviewNormalization',
      ...plannerStepMeta(input.plannerStep),
      ts: new Date().toISOString(),
    },
  };
}

export function buildReportRangeCard(input: ReportRangeCardInput): ApprovalCard {
  const reportLabel = input.reportTypes
    .map((type) => (type === 'idle_members' ? 'Idle members' : 'Overbook members'))
    .join(', ');

  return {
    toolCallId: input.toolCallId,
    intent: 'Confirm PMO report date range',
    riskBadge: 'write',
    summary:
      input.rangeSource === 'database'
        ? 'The goal asks for a PMO report but does not include a clear date range. Choose a range within the available database dates.'
        : 'The ingest-and-report goal has no clear date range. Use the sheet-derived range or choose a range from the database after ingest.',
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'Report types', v: reportLabel },
          { k: 'Suggested from', v: input.suggestedDateRange.from },
          { k: 'Suggested to', v: input.suggestedDateRange.to },
          { k: 'Database minimum', v: input.databaseDateBounds.min },
          { k: 'Database maximum', v: input.databaseDateBounds.max },
          {
            k: 'Suggestion source',
            v: input.rangeSource === 'database' ? 'Canonical PMO database' : 'Uploaded workbook',
          },
        ],
      },
      {
        kind: 'text',
        body: checklistMarkdown([
          'Confirm this range to generate the report after publish.',
          'If this range is not correct, provide a different from/to date before resuming the workflow.',
          'Rejecting this step stops report generation but does not roll back published PMO data.',
        ]),
      },
    ],
    primary: {
      label: 'Generate report',
      argsPatch: {
        decision: 'approve',
        dateRange: input.suggestedDateRange,
        dateRangeStrategy: input.rangeSource === 'database' ? 'manual_database' : 'sheet_derived',
        databaseDateBounds: input.databaseDateBounds,
        rangeSource: input.rangeSource,
      },
    },
    alternates: [],
    decline: { label: 'Skip report', argsPatch: { decision: 'reject' } },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmReportRange',
      ...plannerStepMeta(input.plannerStep),
      ts: new Date().toISOString(),
    },
  };
}
