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
    findings: [
      {
        memberId: 'EMP-YELLOW',
        issueType: 'idle',
        ragColor: 'yellow',
        busyRate: 0.8,
        effortConsumption: 1,
        detail: 'Under allocated',
        excludedWeeks: [],
        issueWeeks: [
          {
            weekId: 'W1',
            weekStart: '2026-06-29',
            weekEnd: '2026-07-03',
            issueType: 'idle',
            ragColor: 'yellow',
            availableHours: 40,
            plannedHours: 32,
            loggedHours: 32,
            busyRate: 0.8,
            effortConsumption: 1,
          },
        ],
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
        explanation: {
          summary:
            'Deterministic idle detection shows spare RA, but that does not automatically justify assigning more work.',
          riskTradeoffs: [
            'Check whether the member matches the required role before reassigning capacity.',
          ],
        },
      },
      {
        memberId: 'EMP-RED',
        issueType: 'overbook',
        ragColor: 'red',
        busyRate: 1.2,
        effortConsumption: 1,
        detail: '<img src=x onerror=alert(1)>',
        excludedWeeks: [{ weekId: 'W1', reason: 'holiday_week' }],
        issueWeeks: [
          {
            weekId: 'W2',
            weekStart: '2026-07-06',
            weekEnd: '2026-07-10',
            issueType: 'overbook',
            ragColor: 'red',
            availableHours: 40,
            plannedHours: 48,
            loggedHours: 48,
            busyRate: 1.2,
            effortConsumption: 1,
          },
        ],
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
        explanation: {
          summary:
            'Deterministic overbook detection is based on persisted metrics and should be treated as a staffing signal, not a prompt inference.',
          riskTradeoffs: [
            'Leaving the allocation unchanged can sustain delivery and burnout risk.',
            'Any transfer still has to respect future project demand and skill fit.',
          ],
        },
      },
      {
        memberId: 'EMP-RED',
        issueType: 'mismatch_over',
        ragColor: 'red',
        busyRate: 1,
        effortConsumption: 1.3,
        detail: 'Effort consumption 130% — logged above plan',
        excludedWeeks: [],
        issueWeeks: [
          {
            weekId: 'W3',
            weekStart: '2026-07-13',
            weekEnd: '2026-07-17',
            issueType: 'mismatch_over',
            ragColor: 'red',
            availableHours: 32,
            plannedHours: 32,
            loggedHours: 42,
            busyRate: 1,
            effortConsumption: 1.3125,
          },
        ],
        annotations: [],
        reviewRequired: true,
        suggestedActionCode: 'REVIEW_RA_TIMESHEET_MISMATCH',
        suggestedActions: [
          {
            actionCode: 'REVIEW_RA_TIMESHEET_MISMATCH',
            templateText:
              'Logged hours exceed planned hours. Review resource allocation accuracy and confirm whether additional effort was authorised.',
            primary: true,
          },
        ],
        metricEvidence: { ...metrics, N01: 1, N06: 1.3 },
        explanation: {
          summary: 'Deterministic mismatch detection found actual effort above planned effort.',
          riskTradeoffs: ['Update RA or confirm whether extra effort was approved.'],
        },
      },
    ],
    recommendations: [
      {
        opportunityId: 'EMP-RED:PRJ-unsafe:BE:2026-06-29:2026-08-07',
        sourceMemberId: 'EMP-RED',
        projectId: 'PRJ-<unsafe>',
        roleNeeded: 'BE',
        severity: 'red',
        evidenceWindow: { from: '2026-06-29', to: '2026-08-07' },
        planningPeriod: { from: '2026-08-10', to: '2026-12-31' },
        currentRaBusyRate: 1.2,
        targetRaBusyRate: 1,
        requiredReductionPct: 0.15,
        requiredReductionHoursPerWeek: 6,
        status: 'partial_relief',
        requiresRaConfirmation: false,
        noResultReasons: [],
        recommendationDegraded: true,
        dataQualityFlags: ['task_embeddings_missing'],
        explanation: {
          summary:
            'Deterministic ranking found a partial relief path, but the evidence is degraded and should be rechecked before execution.',
          riskTradeoffs: [
            'The transfer reduces overload without assuming the target can absorb the full gap.',
          ],
          topChoiceReason:
            'EMP-TARGET has the cleanest capacity fit for the required transfer while keeping the source near the target ceiling.',
          alternativesComparison:
            'Lower-ranked alternatives would create weaker skill or capacity alignment.',
        },
        evidenceVersions: {
          sourceVersions: ['v1'],
          embeddingModelIds: [],
          embeddingSourceHashes: [],
        },
        recommendations: [
          {
            type: 'rebalance',
            opportunityId: 'EMP-RED:PRJ-unsafe:BE:2026-06-29:2026-08-07',
            sourceMemberId: 'EMP-RED',
            targetMemberId: 'EMP-TARGET',
            projectId: 'PRJ-<unsafe>',
            roleNeeded: 'BE',
            effectiveFrom: '2026-08-10',
            effectiveTo: '2026-12-31',
            transferPct: 0.1,
            transferHoursPerWeek: 4,
            score: 0.72,
            confidence: 'medium',
            rankWithinOpportunity: 1,
            portfolioSelected: false,
            mutuallyExclusiveAlternative: true,
            beforeAfter: {
              sourceBeforeBusyRate: 1.2,
              sourceAfterBusyRate: 1.1,
              targetBeforeBusyRate: 0.8,
              targetAfterBusyRate: 0.9,
            },
            scoreBreakdown: {
              skillMatch: 1,
              historyMatch: 0,
              roleContextMatch: 0.4,
              capacityFit: 0.8,
              riskAdjustment: 0.9,
            },
            evidence: {
              matchedSkills: ['java', '<sql>'],
              missingSkills: [],
              similarPastTasks: [],
              sourceRiskFlags: ['actual_utilization_above_100'],
              candidateRiskFlags: [],
              rationale: 'Move 10% allocation from EMP-RED to EMP-TARGET for PRJ-<unsafe>.',
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
    expect(html).toContain('Evidence window: 2026-06-29 to 2026-08-07');
    expect(html).toContain('forward-looking actions from 2026-08-10');
    expect(html).toContain('Explanation of deterministic recommendation');
    expect(html).toContain('Why top-1 leads:');
    expect(html).toContain('Alternatives:');
    expect(html).toContain('Mutually exclusive alternative · revalidate before apply');
    expect(html).toContain('2026-08-10 to 2026-12-31');
    expect(html).not.toContain('Portfolio selected');
  });

  it('renders affected weeks and mismatch findings', () => {
    const { html } = renderReportHtml(model());
    expect(html).toContain('Mismatch');
    expect(html).toContain('Affected weeks');
    expect(html).toContain('Explanation of deterministic finding');
    expect(html).toContain('W2');
    expect(html).toContain('2026-07-06 to 2026-07-10');
    expect(html).toContain('Effort consumption 130%');
  });

  it('renders explicit empty states for red/yellow finding groups', () => {
    const empty = report();
    empty.findings = [];
    empty.recommendations = [];
    const { html } = renderReportHtml(model(empty));
    expect(html.match(/No findings/g)).toHaveLength(6);
  });

  it('summarizes no-result recommendations without rendering fake rebalance cards', () => {
    const value = report();
    const group = value.recommendations[0];
    if (!group) throw new Error('missing recommendation fixture');
    group.status = 'no_valid_rebalance_found';
    group.recommendations = [];
    group.noResultReasons = ['candidate_data_unavailable'];
    const { html } = renderReportHtml(model(value));
    expect(html).not.toContain('No Valid Rebalance Found');
    expect(html).not.toContain('No valid rebalance found:');
    expect(html).toContain('No candidate-backed rebalance was produced for 1 opportunity');
    expect(html).toContain('Candidate Data Unavailable');
    expect(html).toContain('next planning cycle');
    expect(html).not.toContain('Portfolio selected');
  });

  it('escapes all HTML metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
