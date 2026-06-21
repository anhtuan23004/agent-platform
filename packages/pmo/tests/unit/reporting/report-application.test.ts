import { describe, expect, it, vi } from 'vitest';
import type { GeneratePmoReportOutput } from '../../../src/backend/analytics/report.ts';
import type {
  CreateReportRunInput,
  ReportRunEnvelope,
} from '../../../src/backend/reporting/contracts.ts';
import type { ReportApplicationDeps } from '../../../src/backend/reporting/generate-report.ts';
import {
  computeReportPayload,
  createReportRun,
  generateReport,
  sortReportPayload,
} from '../../../src/backend/reporting/generate-report.ts';
import { loadPmoReportRuleCatalog } from '../../../src/backend/reporting/rules/load.ts';
import type { PmoReportRuleSet } from '../../../src/backend/reporting/rules/schema.ts';

const rules = loadPmoReportRuleCatalog()[0] as PmoReportRuleSet;
const resolvedRules = {
  ...rules,
  canonicalJson: JSON.stringify(rules),
  sha256: '0'.repeat(64),
};

function report(memberCount = 2): GeneratePmoReportOutput {
  return {
    dateRange: { from: '2026-06-29', to: '2026-07-05' },
    sourceVersion: {
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-07-05T12:00:00.000Z',
    },
    summary: {
      memberCount,
      overbookCount: 1,
      idleCount: 1,
      excludedWeekCount: 0,
    },
    members: [
      { memberId: 'IDLE', fullName: 'Idle Member', department: 'Engineering', roleTitle: 'Dev' },
      {
        memberId: 'OVERBOOK',
        fullName: 'Overbook Member',
        department: 'Engineering',
        roleTitle: 'Dev',
      },
    ],
    findings: [
      {
        memberId: 'IDLE',
        issueType: 'idle',
        ragColor: 'yellow',
        busyRate: 0.8,
        effortConsumption: 1,
        detail: 'idle',
        excludedWeeks: [],
        annotations: [],
        reviewRequired: true,
        suggestedActionCode: 'REVIEW_WITH_LINE_MANAGER',
        suggestedActions: [
          {
            actionCode: 'REVIEW_WITH_LINE_MANAGER',
            templateText:
              'Discuss allocation gap with line manager. Confirm whether member is available for additional project assignments.',
            primary: true,
          },
        ],
        metricEvidence: {
          N01: 0.8,
          N02: 0.8,
          N03: 1,
          N04: 0.2,
          N05: 0,
          N06: 1,
          N12: null,
        },
      },
      {
        memberId: 'OVERBOOK',
        issueType: 'overbook',
        ragColor: 'red',
        busyRate: 1.2,
        effortConsumption: 1,
        detail: 'overbook',
        excludedWeeks: [],
        annotations: [],
        reviewRequired: true,
        suggestedActionCode: 'REBALANCE_ALLOCATION',
        suggestedActions: [
          {
            actionCode: 'REBALANCE_ALLOCATION',
            templateText:
              'Review workload allocation with project leads and consider redistributing hours to under-utilised team members.',
            primary: true,
          },
        ],
        metricEvidence: {
          N01: 1.2,
          N02: 1.2,
          N03: 1,
          N04: 0,
          N05: 0,
          N06: 1,
          N12: null,
        },
      },
    ],
    recommendations: [],
  };
}

function dependencies(overrides: Partial<ReportApplicationDeps> = {}): ReportApplicationDeps {
  const envelope: ReportRunEnvelope = {
    request: {
      sourceMode: 'canonical_db' as const,
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      reportTypes: ['overbook', 'idle'],
      outputFormat: 'json' as const,
    },
    ruleSnapshot: {
      ruleSetId: rules.ruleSetId,
      version: rules.version,
      sha256: 'hash',
      rules,
    },
  };
  return {
    resolveRules: vi.fn(async () => resolvedRules),
    insertQueued: vi.fn(async () => '44444444-4444-4444-4444-444444444444'),
    getRun: vi.fn(async () => ({
      id: '44444444-4444-4444-4444-444444444444',
      tenantId: 'tenant-1',
      ingestionSessionId: null,
      status: 'queued' as const,
      envelope,
      report: null,
      htmlS3Key: null,
      htmlSha256: null,
      htmlSizeBytes: null,
      pdfS3Key: null,
      pdfSha256: null,
      pdfSizeBytes: null,
      failureCode: null,
      failureMessage: null,
      createdAt: new Date('2026-06-21T00:00:00.000Z'),
      updatedAt: new Date('2026-06-21T00:00:00.000Z'),
      completedAt: null,
    })),
    setComputing: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    saveComputed: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    computeAnalytics: vi.fn(async () => report()),
    verifyPublishedSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

const baseInput: CreateReportRunInput = {
  tenantId: 'tenant-1',
  actorId: 'user-1',
  sourceMode: 'canonical_db' as const,
  dateRange: { from: '2026-06-29', to: '2026-07-05' },
  reportTypes: ['idle_members', 'overbook_members'],
};

describe('report application service', () => {
  it('creates a fresh queued run with canonical types and immutable rule snapshot', async () => {
    const deps = dependencies();
    const id = await createReportRun(baseInput, deps);

    expect(id).toBe('44444444-4444-4444-4444-444444444444');
    expect(deps.verifyPublishedSession).not.toHaveBeenCalled();
    expect(deps.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestionSessionId: null,
        reportTypes: ['overbook', 'idle'],
        envelope: expect.objectContaining({
          request: expect.objectContaining({ reportTypes: ['overbook', 'idle'] }),
          ruleSnapshot: expect.objectContaining({
            ruleSetId: rules.ruleSetId,
            version: rules.version,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
      }),
    );
  });

  it('requires a tenant-owned published session for upload path', async () => {
    const deps = dependencies();
    await createReportRun(
      {
        ...baseInput,
        sourceMode: 'after_upload_publish',
        ingestionSessionId: 'session-1',
      },
      deps,
    );
    expect(deps.verifyPublishedSession).toHaveBeenCalledWith('tenant-1', 'session-1');

    await expect(
      createReportRun({ ...baseInput, sourceMode: 'after_upload_publish' }, deps),
    ).rejects.toThrow('report_ingestion_session_required');
  });

  it('rejects date ranges above configured maximum', async () => {
    await expect(
      createReportRun(
        { ...baseInput, dateRange: { from: '2026-01-01', to: '2026-08-01' } },
        dependencies(),
      ),
    ).rejects.toThrow('report_date_range_exceeds_max_weeks:26');
  });

  it('computes, sorts, and completes the same persisted run', async () => {
    const deps = dependencies();
    const result = await computeReportPayload(
      { tenantId: 'tenant-1', reportRunId: '44444444-4444-4444-4444-444444444444' },
      deps,
    );

    expect(result.findings.map((finding) => finding.memberId)).toEqual(['OVERBOOK', 'IDLE']);
    expect(deps.setComputing).toHaveBeenCalled();
    expect(deps.computeAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        reportTypes: ['overbook_members', 'idle_members'],
        reportSource: 'canonical_db',
      }),
    );
    expect(deps.complete).toHaveBeenCalledWith(
      expect.objectContaining({ report: result, envelope: expect.any(Object) }),
    );
  });

  it('marks failed when PDF size policy rejects result', async () => {
    const deps = dependencies({
      getRun: vi.fn(async () => {
        const base = await dependencies().getRun('tenant-1', 'run-1');
        return {
          ...base,
          envelope: {
            ...base.envelope,
            request: { ...base.envelope.request, outputFormat: 'pdf' as const },
          },
        };
      }),
      computeAnalytics: vi.fn(async () => report(1001)),
    });
    await expect(
      computeReportPayload({ tenantId: 'tenant-1', reportRunId: 'run-1' }, deps),
    ).rejects.toThrow('report_pdf_limits_exceeded');
    expect(deps.fail).toHaveBeenCalledWith(
      'tenant-1',
      'run-1',
      expect.objectContaining({ code: 'report_pdf_limits_exceeded' }),
    );
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('persists PDF payload in rendering state instead of completing early', async () => {
    const deps = dependencies({
      getRun: vi.fn(async () => {
        const base = await dependencies().getRun('tenant-1', 'run-1');
        return {
          ...base,
          envelope: {
            ...base.envelope,
            request: { ...base.envelope.request, outputFormat: 'pdf' as const },
          },
        };
      }),
    });
    const result = await computeReportPayload({ tenantId: 'tenant-1', reportRunId: 'run-1' }, deps);
    expect(deps.saveComputed).toHaveBeenCalledWith(
      expect.objectContaining({ report: result, envelope: expect.any(Object) }),
    );
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('facade always creates a new run then computes it', async () => {
    const deps = dependencies();
    const result = await generateReport(baseInput, deps);
    expect(result.reportRunId).toBe('44444444-4444-4444-4444-444444444444');
    expect(deps.insertQueued).toHaveBeenCalledTimes(1);
    expect(deps.computeAnalytics).toHaveBeenCalledTimes(1);
  });
});

describe('sortReportPayload', () => {
  it('is deterministic without mutating source arrays', () => {
    const source = report();
    const original = source.findings.map((finding) => finding.memberId);
    const first = sortReportPayload(source);
    const second = sortReportPayload(source);
    expect(first).toEqual(second);
    expect(source.findings.map((finding) => finding.memberId)).toEqual(original);
  });
});
