import { appendCheckpoint, appendProposal, approveProposal, createProposal } from '@seta/ingestion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DbChangeSummaryResult,
  NormalizationResult,
  StagingChangeSummary,
} from '../../../../src/backend/workflows/ingest-data-v2/handlers/common.ts';
import { createDatabaseChangeSummaryHandler } from '../../../../src/backend/workflows/ingest-data-v2/handlers/database-change-summary.ts';
import type { PmoDynamicHandlerInput } from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

const baseStep = {
  step_no: 4,
  planner_step_id: 'pmo.planner.step.4.database_change_summary',
  action_id: 'database_change_summary',
  review_type: 'publish',
  step_name: 'Database change summary',
  status: 'in_progress',
} as const;

const baseChangeSummary: StagingChangeSummary = [
  {
    tableId: 'resource_allocation',
    counts: {
      new_records: 1,
      updated_records: 0,
      exact_duplicates: 0,
      duplicates_in_upload: 0,
    },
    sampleChanges: [
      {
        type: 'new_record',
        naturalKey: { member_id: 'M-001' },
        newValues: { member_id: 'M-001' },
      },
    ],
  },
];

const baseStaging = {
  changeSummary: baseChangeSummary,
  blockingIssues: [],
  mappingReviewRows: [],
  hasBlockingIssues: false,
  hasUpdates: true,
  requiresReview: true,
};

const baseNormalizationResult: NormalizationResult = {
  ...baseStaging,
  rowCountsByTable: {
    resource_allocation: 1,
  },
  duplicateInUploadRows: [],
  reviewRows: [],
};

const deps = {
  domainAdapter: {
    domainId: 'pmo',
    findReferenceValues: vi.fn(async () => new Set<string>()),
    findActiveRecords: vi.fn(async () => []),
    publish: vi.fn(async () => ({
      rowsWritten: { resource_allocation: 1 },
      rowsUpdated: {},
      rowsSkipped: {},
    })),
  },
  resolveCardIdentity: () => ({
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
  }),
  readPlannerStepMeta: async () => null,
} satisfies Parameters<typeof createDatabaseChangeSummaryHandler>[0];

function makeInput(overrides: Partial<PmoDynamicHandlerInput> = {}): PmoDynamicHandlerInput {
  return {
    ingestionSessionId: '33333333-3333-3333-3333-333333333333',
    fileKey: 'tenant/file.xlsx',
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    runId: 'run-1',
    requestContext: { get: () => undefined },
    resumeData: undefined,
    step: baseStep,
    planningPlan: null,
    runtimeContext: {
      staging_result: baseStaging,
    },
    ...overrides,
  };
}

describe('createDatabaseChangeSummaryHandler', () => {
  beforeEach(() => {
    vi.mocked(deps.domainAdapter.publish).mockClear();
  });

  it('creates a review proposal before suspending for DB change approval', async () => {
    const result = await createDatabaseChangeSummaryHandler(deps).execute(makeInput());

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.intent).toBe('Review staged database changes');
    expect(result.card.primary.label).toBe('Complete review');
    const proposals = result.runtimeContextPatch?.staging_result?.review_proposals;
    expect(proposals?.database_change_summary).toHaveLength(1);
    expect(proposals?.database_change_summary?.[0]).toMatchObject({
      step_id: 'database_change_summary',
      version: 1,
      status: 'needs_review',
      review_required: true,
    });
  });

  it('uses publish approval copy only for an explicit publish intent', async () => {
    const result = await createDatabaseChangeSummaryHandler(deps).execute(
      makeInput({
        planningPlan: {
          intent_analysis: { writePolicy: 'requires_approval' },
        },
      }),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.intent).toBe('Review staging changes before publish');
    expect(result.card.primary.label).toBe('Approve publish');
  });

  it('approves the latest DB change proposal without publishing staged rows', async () => {
    const proposal = createProposal<DbChangeSummaryResult>({
      state: {},
      stepId: 'database_change_summary',
      proposal: {
        changeSummary: baseStaging.changeSummary,
        blockingIssues: [],
        mappingReviewRows: [],
        hasBlockingIssues: false,
        hasUpdates: true,
        requiresReview: true,
      },
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve', 'reject'],
      createdBy: 'agent',
      proposalId: 'proposal-1',
      createdAt: '2026-06-17T00:00:00.000Z',
    });
    const stagingWithProposal = {
      ...baseStaging,
      ...appendProposal({}, proposal),
    };

    const result = await createDatabaseChangeSummaryHandler(deps).execute(
      makeInput({
        resumeData: { decision: 'approve' },
        runtimeContext: {
          staging_result: stagingWithProposal,
        },
      }),
    );

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') throw new Error('expected completed');
    expect(result.sessionStatus).toBe('reviewed');
    const checkpoints = result.runtimeContextPatch?.staging_result?.approved_checkpoints;
    expect(checkpoints?.database_change_summary).toHaveLength(1);
    expect(checkpoints?.database_change_summary?.[0]).toMatchObject({
      proposal_id: 'proposal-1',
      step_id: 'database_change_summary',
      version: 1,
      approved_by: '22222222-2222-2222-2222-222222222222',
    });
    expect(deps.domainAdapter.publish).not.toHaveBeenCalled();
    expect(result.outputSummary).toMatchObject({
      status: 'reviewed',
      checkpoint_version: 1,
    });
    expect(result.terminalOutput).toMatchObject({
      status: 'completed',
      rowsWritten: {},
    });
  });

  it('requires an approved normalization checkpoint when a normalization proposal exists', async () => {
    const normalizationProposal = createProposal<NormalizationResult>({
      state: {},
      stepId: 'normalize_to_staging',
      proposal: baseNormalizationResult,
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve', 'reject'],
      createdBy: 'agent',
      proposalId: 'normalization-proposal-1',
      createdAt: '2026-06-17T00:00:00.000Z',
    });

    await expect(
      createDatabaseChangeSummaryHandler(deps).execute(
        makeInput({
          runtimeContext: {
            staging_result: {
              ...baseStaging,
              ...appendProposal({}, normalizationProposal),
            },
          },
        }),
      ),
    ).rejects.toThrow('approved_checkpoint_missing:normalize_to_staging');
  });

  it('allows DB change summary after normalization checkpoint approval', async () => {
    const normalizationProposal = createProposal<NormalizationResult>({
      state: {},
      stepId: 'normalize_to_staging',
      proposal: baseNormalizationResult,
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve', 'reject'],
      createdBy: 'agent',
      proposalId: 'normalization-proposal-1',
      createdAt: '2026-06-17T00:00:00.000Z',
    });
    const normalizationCheckpoint = approveProposal({
      proposal: normalizationProposal,
      approvedOutput: baseNormalizationResult,
      approvedBy: '22222222-2222-2222-2222-222222222222',
      checkpointId: 'normalization-checkpoint-1',
      approvedAt: '2026-06-17T00:01:00.000Z',
    });
    const stagingWithNormalizationCheckpoint = {
      ...baseStaging,
      ...appendCheckpoint(appendProposal({}, normalizationProposal), normalizationCheckpoint),
    };

    const result = await createDatabaseChangeSummaryHandler(deps).execute(
      makeInput({
        runtimeContext: {
          staging_result: stagingWithNormalizationCheckpoint,
        },
      }),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(
      result.runtimeContextPatch?.staging_result?.review_proposals?.database_change_summary,
    ).toHaveLength(1);
  });

  it('allows DB change summary after approved duplicate-in-upload resolution', async () => {
    const normalizationWithResolvedDuplicates: NormalizationResult = {
      ...baseNormalizationResult,
      duplicateInUploadRows: [
        {
          tableId: 'resource_allocation',
          rowId: 'resource_allocation:RA:3',
          duplicateGroupKey: 'resource_allocation:abc',
          naturalKey: { member_id: 'M-001', project_id: 'P-001' },
          sourceRow: 3,
          policy: 'block',
        },
      ],
    };
    const normalizationProposal = createProposal<NormalizationResult>({
      state: {},
      stepId: 'normalize_to_staging',
      proposal: normalizationWithResolvedDuplicates,
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve', 'reject'],
      createdBy: 'agent',
      proposalId: 'normalization-proposal-1',
      createdAt: '2026-06-17T00:00:00.000Z',
    });
    const normalizationCheckpoint = approveProposal({
      proposal: normalizationProposal,
      approvedOutput: normalizationWithResolvedDuplicates,
      approvedBy: '22222222-2222-2222-2222-222222222222',
      checkpointId: 'normalization-checkpoint-1',
      approvedAt: '2026-06-17T00:01:00.000Z',
    });

    const result = await createDatabaseChangeSummaryHandler(deps).execute(
      makeInput({
        runtimeContext: {
          staging_result: {
            ...baseStaging,
            ...appendCheckpoint(appendProposal({}, normalizationProposal), normalizationCheckpoint),
          },
        },
      }),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.primary.label).toBe('Complete review');
  });

  it('does not create a checkpoint for blocked DB change summaries', async () => {
    const result = await createDatabaseChangeSummaryHandler(deps).execute(
      makeInput({
        resumeData: { decision: 'approve' },
        runtimeContext: {
          staging_result: {
            ...baseStaging,
            blockingIssues: [
              {
                tableId: 'resource_allocation',
                sourceRow: 2,
                field: 'member_id',
                reason: 'missing member',
              },
            ],
            hasBlockingIssues: true,
          },
        },
      }),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(
      result.runtimeContextPatch?.staging_result?.approved_checkpoints?.database_change_summary,
    ).toBeUndefined();
    expect(deps.domainAdapter.publish).not.toHaveBeenCalled();
  });
});
