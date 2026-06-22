import { describe, expect, it } from 'vitest';
import type { GeneratePmoReportOutput } from '../../../src/backend/analytics/report.ts';
import type { PmoReportRenderModel } from '../../../src/backend/reporting/render/contracts.ts';
import {
  escapeHtml,
  renderReportHtml,
} from '../../../src/backend/reporting/render/render-report-html.ts';

const metrics = {
  N01: 1.2,
  N02: 1.1,
  N03: 0.9,
  N04: 0,
  N05: 0.1,
  N06: 1,
  N12: null,
};

function report(): GeneratePmoReportOutput {
  return {
    dateRange: { from: '2026-06-29', to: '2026-08-07' },
    sourceVersion: {
      factsVersion: 'facts-1234567890',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-08-07T12:00:00.000Z',
    },
    summary: { memberCount: 3, overbookCount: 1, idleCount: 1, excludedWeekCount: 1 },
    members: [
      {
        memberId: 'EMP-RED',
        fullName: `<script>alert("red")</script> ${'Very Long Name '.repeat(12)}`,
        department: 'Engineering & Delivery',
        roleTitle: 'Backend <Lead>',
      },
      {
        memberId: 'EMP-YELLOW',
        fullName: 'Yellow Member',
        department: 'QA',
        roleTitle: 'Tester',
      },
      {
        memberId: 'EMP-TARGET',
        fullName: 'Target & Candidate',
        department: 'Engineering',
        roleTitle: 'Developer',
      },
    ],
    projectionFreshness: {
      skillsCount: 2,
      taskHistoryCount: 1,
      lastSyncedAt: '2026-08-07T23:59:59.000Z',
      degraded: false,
    },
    dataQuality: { recommendationDegraded: false, flags: [] },
    findings: [
      {
        memberId: 'EMP-YELLOW',
        issueType: 'idle',
        ragColor: 'yellow',
        busyRate: 0.8,
        effortConsumption: 1,
        detail: 'Under allocated',
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
        metricEvidence: { ...metrics, N01: 0.8 },
      },
      {
        memberId: 'EMP-RED',
        issueType: 'overbook',
        ragColor: 'red',
        busyRate: 1.2,
        effortConsumption: 1,
        detail: '<img src=x onerror=alert(1)>',
        excludedWeeks: [{ weekId: 'W1', reason: 'holiday_week' }],
        annotations: [{ weekId: 'W2', reason: 'training' }],
        reviewRequired: true,
        suggestedActionCode: 'REBALANCE_ALLOCATION',
        suggestedActions: [
          {
            actionCode: 'REBALANCE_ALLOCATION',
            templateText:
              'Review workload allocation with project leads and consider redistributing hours to under-utilised team members.',
            primary: true,
          },
          {
            actionCode: 'VALIDATE_TRAINING_TIME',
            templateText:
              'Training hours recorded during the reporting period. Validate training attendance and ensure it is reflected in the capacity plan.',
            primary: false,
          },
        ],
        metricEvidence: metrics,
      },
    ],
    recommendations: [
      {
        sourceMemberId: 'EMP-RED',
        weekId: 'W2',
        severity: 'red',
        requiredReductionHours: 6,
        status: 'partial_relief',
        noResultReasons: [],
        recommendationDegraded: true,
        dataQualityFlags: ['task_embeddings_missing'],
        evidenceVersions: {
          sourceVersions: ['v1'],
          embeddingModelIds: [],
          embeddingSourceHashes: [],
        },
        recommendations: [
          {
            type: 'rebalance',
            sourceMemberId: 'EMP-RED',
            targetMemberId: 'EMP-TARGET',
            weekId: 'W2',
            projectId: 'PRJ-<unsafe>',
            transferHours: 4,
            score: 0.72,
            confidence: 'medium',
            rankWithinSource: 1,
            portfolioSelected: false,
            mutuallyExclusiveAlternative: true,
            beforeAfter: {
              sourceBeforeBusyRate: 1.2,
              sourceAfterBusyRate: 1.1,
              targetBeforeBusyRate: 0.8,
              targetAfterBusyRate: 0.9,
            },
            scoreBreakdown: {
              skillCoverage: 1,
              taskHistorySimilarity: 0,
              capacityFit: 0.8,
              projectContext: 0.4,
            },
            evidence: {
              matchedSkills: ['java', '<sql>'],
              missingSkills: [],
              similarPastTasks: [],
              capacityReason: 'source_overbook_reduced',
            },
            recommendationDegraded: true,
            dataQualityFlags: ['task_embeddings_missing'],
          },
        ],
      },
    ],
  };
}

function model(value: GeneratePmoReportOutput = report()): PmoReportRenderModel {
  return {
    reportRunId: '44444444-4444-4444-8444-444444444444',
    tenantName: 'SETA <Vietnam> & Co',
    generatedAt: '2026-08-07T12:30:00.000Z',
    sourceMode: 'canonical_db',
    rule: { ruleSetId: 'SETA-08-SOP-001', version: '2026-01-01', sha256: 'a'.repeat(64) },
    report: value,
  };
}

describe('renderReportHtml', () => {
  it('renders deterministic standalone A4 HTML with checksum', () => {
    const first = renderReportHtml(model());
    const second = renderReportHtml(model());
    expect(first).toEqual(second);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sizeBytes).toBe(Buffer.byteLength(first.html));
    expect(first.html).toContain('@page { size: A4 portrait;');
    expect(first.html).toContain('thead { display: table-header-group; }');
    expect(first.html).not.toMatch(/<link|<script|https?:\/\//i);
  });

  it('orders red before yellow and escapes every evidence string', () => {
    const { html } = renderReportHtml(model());
    expect(html.indexOf('Red severity')).toBeLessThan(html.indexOf('Yellow severity'));
    expect(html).toContain('SETA &lt;Vietnam&gt; &amp; Co');
    expect(html).toContain('&lt;script&gt;alert(&quot;red&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('PRJ-&lt;unsafe&gt;');
    expect(html).toContain('&lt;sql&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
  });

  it('labels partial/degraded recommendations and alternatives honestly', () => {
    const { html } = renderReportHtml(model());
    expect(html).toContain('Partial Relief');
    expect(html).toContain('Evidence degraded:');
    expect(html).toContain('Mutually exclusive alternative · revalidate before apply');
    expect(html).not.toContain('Portfolio selected');
  });

  it('renders explicit empty states for red/yellow overbook/idle groups', () => {
    const empty = report();
    empty.findings = [];
    empty.recommendations = [];
    const { html } = renderReportHtml(model(empty));
    expect(html.match(/No findings/g)).toHaveLength(4);
  });

  it('renders no-result recommendation as unsolved', () => {
    const value = report();
    const group = value.recommendations[0];
    if (!group) throw new Error('missing recommendation fixture');
    group.status = 'no_valid_rebalance_found';
    group.recommendations = [];
    group.noResultReasons = ['insufficient_capacity'];
    const { html } = renderReportHtml(model(value));
    expect(html).toContain('No Valid Rebalance Found');
    expect(html).toContain('No valid rebalance found: Insufficient Capacity');
    expect(html).not.toContain('Portfolio selected');
  });

  it('escapes all HTML metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
