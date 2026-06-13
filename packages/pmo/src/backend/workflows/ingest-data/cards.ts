import type { ApprovalCard } from '@seta/agent-sdk';
import type { z } from 'zod';
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

interface MappingItemCardInput {
  ingestionSessionId: string;
  workbookConfidence: number;
  validationStatus: 'confirmed' | 'needs_review' | 'blocked';
  reviewItems: MappingReviewItem[];
  approvedItemIds: string[];
  mappingOverrides: MappingOverride[];
  currentItemId: string;
  identity: CardIdentity;
  toolCallId: string;
}

interface PublishCardInput {
  ingestionSessionId: string;
  changeSummary: ChangeSummaryTable[];
  blockingIssues: BlockingIssue[];
  allowApprove: boolean;
  identity: CardIdentity;
  toolCallId: string;
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

export function buildMappingItemReviewCard(input: MappingItemCardInput): ApprovalCard {
  const totalItems = input.reviewItems.length;
  const safeApproved = input.approvedItemIds.filter((id) =>
    input.reviewItems.some((item) => item.id === id),
  );
  const currentItem =
    input.reviewItems.find((item) => item.id === input.currentItemId) ?? input.reviewItems[0];

  if (!currentItem) {
    throw new Error('mapping_review_items_empty');
  }

  const approvedCount = safeApproved.length;
  const itemOrdinal = approvedCount + 1;
  const safeOverrides = mergeMappingOverrides(input.mappingOverrides);
  const summary = `Review mapping item ${itemOrdinal}/${totalItems}. Approve each item to continue.`;
  const alternateCandidates = currentItem.candidates.filter(
    (candidate) => candidate.sourceColumn !== currentItem.sourceColumn,
  );

  const alternates = alternateCandidates.map((candidate) => {
    const override: MappingOverride = {
      tableId: currentItem.tableId,
      field: currentItem.field,
      sourceColumn: candidate.sourceColumn,
      confidence: candidate.confidence,
      blocked: candidate.blocked,
    };

    return {
      label: `Use ${candidate.sourceColumn}${candidate.blocked ? ' (blocked)' : ''}`,
      argsPatch: {
        decision: 'modify',
        approvedItemKeys: safeApproved,
        mappingOverride: override,
        mappingOverrides: upsertMappingOverride(safeOverrides, override),
      },
    };
  });

  const candidateItems = currentItem.candidates.map((candidate) => ({
    id: `${currentItem.tableId}|${currentItem.field}|${candidate.sourceColumn}`,
    label: candidate.sourceColumn,
    secondary: candidate.blocked
      ? `confidence ${percent(candidate.confidence)} • blocked by data type`
      : `confidence ${percent(candidate.confidence)}`,
    score: candidate.confidence,
  }));

  const reviewProgressRows = capRows(
    input.reviewItems.map((item) => {
      const state = safeApproved.includes(item.id)
        ? 'approved'
        : item.id === currentItem.id
          ? 'current review'
          : 'pending review';
      const sourceColumn = item.sourceColumn ?? '-';
      const confidence = typeof item.confidence === 'number' ? percent(item.confidence) : '-';
      return {
        k: `${item.tableId}.${item.field}`,
        v: `${state} | ${item.issueType} | ${sourceColumn} | ${confidence}`,
      };
    }),
    30,
  );

  return {
    toolCallId: input.toolCallId,
    intent: 'Approve mapping item',
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
        rows: [
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
        body: checklistMarkdown([
          'Approve this item if the mapping is acceptable.',
          'Use Modify to switch the source column directly in this PMO tab.',
          'Reject upload if this mapping issue should not proceed.',
          'The workflow continues only after all mapping items are approved.',
        ]),
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
      label: `Approve item ${itemOrdinal}/${totalItems}`,
      argsPatch: {
        decision: 'approve',
        approvedItemKey: currentItem.id,
        approvedItemKeys: safeApproved,
        mappingOverrides: safeOverrides,
      },
    },
    alternates,
    decline: {
      label: 'Reject upload',
      argsPatch: {
        decision: 'reject',
        approvedItemKeys: safeApproved,
        mappingOverrides: safeOverrides,
      },
    },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmMapping',
      ts: new Date().toISOString(),
    },
  };
}

function publishRows(changeSummary: ChangeSummaryTable[]): Array<{ k: string; v: string }> {
  return changeSummary.map((t) => {
    const c = t.counts;
    const upsertRows = c.new_records + c.updated_records;
    const skippedRows = c.exact_duplicates + c.duplicates_in_upload;
    return {
      k: t.tableId,
      v: `upsert=${upsertRows} | skip=${skippedRows} | new=${c.new_records} | updated=${c.updated_records} | exact_dup=${c.exact_duplicates} | dup_in_upload=${c.duplicates_in_upload}`,
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

  const summary = input.allowApprove
    ? `Ready to publish ${totals.newRecords + totals.updatedRecords} effective change(s).`
    : [
        input.blockingIssues.length > 0
          ? `Found ${input.blockingIssues.length} blocking data issue(s).`
          : null,
        totals.duplicatesInUpload > 0
          ? `Found ${totals.duplicatesInUpload} duplicate-in-upload row(s).`
          : null,
        'Publish approval is disabled until issues are resolved.',
      ]
        .filter(Boolean)
        .join(' ');

  const checklist = input.allowApprove
    ? [
        'Updated rows are expected and reviewed.',
        'No conflicting duplicate-in-upload rows remain for blocked tables.',
        'Proceed with publish upsert.',
      ]
    : [
        'Duplicate rows within this upload violate table duplicate policy.',
        'Rows with parse/required errors must be corrected in the workbook.',
        'Reject this run and fix duplicate rows before retrying.',
      ];
  const sampleRows = publishSampleRows(input.changeSummary);
  const issueRows = blockingIssueRows(input.blockingIssues);

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
          { k: 'Rows to upsert', v: String(totals.newRecords + totals.updatedRecords) },
          { k: 'Rows to skip', v: String(totals.exactDuplicates + totals.duplicatesInUpload) },
          { k: 'New rows', v: String(totals.newRecords) },
          { k: 'Updated rows', v: String(totals.updatedRecords) },
          { k: 'Exact duplicates', v: String(totals.exactDuplicates) },
          { k: 'Duplicates in upload', v: String(totals.duplicatesInUpload) },
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
      ts: new Date().toISOString(),
    },
  };
}
