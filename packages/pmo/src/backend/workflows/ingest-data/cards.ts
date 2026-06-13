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

export interface MappingReviewItem {
  id: string;
  tableId: string;
  sourceSheet: string;
  field: string;
  issueType: 'needs_review' | 'blocked' | 'required_missing' | 'ambiguous';
  sourceColumn?: string;
  confidence?: number;
  note: string;
}

interface MappingItemCardInput {
  ingestionSessionId: string;
  workbookConfidence: number;
  validationStatus: 'confirmed' | 'needs_review' | 'blocked';
  reviewItems: MappingReviewItem[];
  approvedItemIds: string[];
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

export function collectMappingReviewItems(tableMappings: TableMapping[]): MappingReviewItem[] {
  const out: MappingReviewItem[] = [];

  for (const table of tableMappings) {
    for (const mapping of table.mappings) {
      if (mapping.status === 'auto_accept') continue;
      out.push({
        id: `${table.tableId}|mapping|${mapping.canonicalField}|${mapping.sourceColumn}|${mapping.status}`,
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field: mapping.canonicalField,
        issueType: mapping.status,
        sourceColumn: mapping.sourceColumn,
        confidence: mapping.confidence,
        note: `${mapping.status} <- ${mapping.sourceColumn} (${percent(mapping.confidence)})`,
      });
    }

    for (const field of table.unmappedRequired) {
      out.push({
        id: `${table.tableId}|required_missing|${field}`,
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field,
        issueType: 'required_missing',
        note: 'required field has no mapped source column',
      });
    }

    for (const field of table.ambiguous) {
      out.push({
        id: `${table.tableId}|ambiguous|${field}`,
        tableId: table.tableId,
        sourceSheet: table.sourceSheet,
        field,
        issueType: 'ambiguous',
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
  const summary = `Review mapping item ${itemOrdinal}/${totalItems}. Approve each item to continue.`;
  const reviewProgressRows = capRows(
    input.reviewItems.map((item) => {
      const state = safeApproved.includes(item.id)
        ? 'approved'
        : item.id === currentItem.id
          ? 'current review'
          : 'pending review';
      return {
        k: `${item.tableId}.${item.field}`,
        v: `${state} | ${item.issueType}`,
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
          'Reject upload if this mapping issue should not proceed.',
          'The workflow continues only after all mapping items are approved.',
        ]),
      },
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
      },
    },
    alternates: [],
    decline: {
      label: 'Reject upload',
      argsPatch: { decision: 'reject', approvedItemKeys: safeApproved },
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
