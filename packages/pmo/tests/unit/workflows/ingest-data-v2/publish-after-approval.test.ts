import { appendCheckpoint, appendProposal, approveProposal, createProposal } from '@seta/ingestion';
import { describe, expect, it, vi } from 'vitest';
import type {
  DbChangeSummaryResult,
  StagingChangeSummary,
} from '../../../../src/backend/workflows/ingest-data-v2/handlers/common.ts';
import { createPublishAfterApprovalHandler } from '../../../../src/backend/workflows/ingest-data-v2/handlers/publish-after-approval.ts';
import type { PmoDynamicHandlerInput } from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

const baseStep = {
  step_no: 5,
  planner_step_id: 'pmo.planner.step.5.publish_after_approval',
  action_id: 'publish_after_approval',
  review_type: 'publish',
  step_name: 'Publish after approval',
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

const dbChangeResult: DbChangeSummaryResult = {
  changeSummary: baseStaging.changeSummary,
  blockingIssues: [],
  mappingReviewRows: [],
  hasBlockingIssues: false,
  hasUpdates: true,
  requiresReview: true,
};

function makeDeps() {
  return {
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
  } satisfies Parameters<typeof createPublishAfterApprovalHandler>[0];
}

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

describe('createPublishAfterApprovalHandler', () => {
  it('publishes directly from an approved DB change checkpoint', async () => {
    const proposal = createProposal({
      state: {},
      stepId: 'database_change_summary',
      proposal: dbChangeResult,
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve'],
      createdBy: 'agent',
      proposalId: 'proposal-1',
    });
    const checkpoint = approveProposal({
      proposal,
      approvedOutput: dbChangeResult,
      approvedBy: 'user-1',
      checkpointId: 'checkpoint-1',
    });
    const checkpointState = appendCheckpoint(appendProposal({}, proposal), checkpoint);
    const deps = makeDeps();

    const result = await createPublishAfterApprovalHandler(deps).execute(
      makeInput({
        runtimeContext: {
          staging_result: {
            ...baseStaging,
            ...checkpointState,
          },
        },
      }),
    );

    expect(result.kind).toBe('completed');
    expect(deps.domainAdapter.publish).toHaveBeenCalledOnce();
    expect(result.kind === 'completed' ? result.outputSummary : {}).toMatchObject({
      status: 'published',
      db_change_checkpoint_version: 1,
    });
    expect(result.kind === 'completed' ? result.sessionPatch : {}).toMatchObject({
      publish_reviewed_at: expect.any(Date),
    });
  });

  it('blocks publish when a DB change proposal has not been approved', async () => {
    const proposal = createProposal({
      state: {},
      stepId: 'database_change_summary',
      proposal: dbChangeResult,
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve'],
      createdBy: 'agent',
      proposalId: 'proposal-1',
    });

    await expect(
      createPublishAfterApprovalHandler(makeDeps()).execute(
        makeInput({
          runtimeContext: {
            staging_result: {
              ...baseStaging,
              ...appendProposal({}, proposal),
            },
          },
        }),
      ),
    ).rejects.toThrow('approved_checkpoint_missing:database_change_summary');
  });

  it('creates a DB change proposal when publish is reached without an earlier DB summary step', async () => {
    const result = await createPublishAfterApprovalHandler(makeDeps()).execute(makeInput());

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(
      result.runtimeContextPatch?.staging_result?.review_proposals?.database_change_summary,
    ).toHaveLength(1);
  });

  it('does not seed recommendation projections from demo CSV after approving publish', async () => {
    const deps = makeDeps();
    const result = await createPublishAfterApprovalHandler(deps).execute(
      makeInput({ resumeData: { decision: 'approve' } }),
    );

    expect(result.kind).toBe('completed');
    expect(deps.domainAdapter.publish).toHaveBeenCalledOnce();
  });
});
