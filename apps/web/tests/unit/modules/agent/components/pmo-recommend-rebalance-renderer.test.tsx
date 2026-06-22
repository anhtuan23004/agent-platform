import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PmoRecommendRebalanceRenderer } from '@/modules/agent/components/tool-renderers/pmo.generate-report';

const members = [
  { memberId: 'EMP-001', fullName: 'Source One' },
  { memberId: 'EMP-002', fullName: 'Target Two' },
];

function candidateOutput() {
  return {
    dateRange: { from: '2026-06-29', to: '2026-07-05' },
    members,
    projectionFreshness: {
      skillsCount: 8,
      taskHistoryCount: 5,
      lastSyncedAt: '2026-07-05T00:00:00.000Z',
      degraded: false,
    },
    dataQuality: { recommendationDegraded: false, flags: [] },
    recommendations: [
      {
        sourceMemberId: 'EMP-001',
        weekId: 'W1',
        severity: 'red' as const,
        requiredReductionHours: 8,
        status: 'full_solution' as const,
        noResultReasons: [],
        recommendationDegraded: false,
        dataQualityFlags: [],
        recommendations: [
          {
            targetMemberId: 'EMP-002',
            projectId: 'PRJ-1',
            transferHours: 8,
            score: 0.91,
            confidence: 'high' as const,
            rankWithinSource: 1,
            portfolioSelected: true,
            mutuallyExclusiveAlternative: false,
            beforeAfter: {
              sourceBeforeBusyRate: 1.2,
              sourceAfterBusyRate: 1,
              targetBeforeBusyRate: 0.7,
              targetAfterBusyRate: 0.9,
            },
            evidence: {
              matchedSkills: ['java', 'spring boot'],
              missingSkills: [],
              similarPastTasks: ['API endpoint implementation'],
            },
            recommendationDegraded: false,
            dataQualityFlags: [],
          },
        ],
      },
    ],
  };
}

describe('PmoRecommendRebalanceRenderer', () => {
  it('renders explicit empty state when no groups return', () => {
    render(
      <PmoRecommendRebalanceRenderer
        name="Recommend PMO Rebalance"
        state="output-available"
        output={{
          dateRange: { from: '2026-06-29', to: '2026-07-05' },
          members: [],
          recommendations: [],
          dataQuality: { recommendationDegraded: false, flags: [] },
          projectionFreshness: {
            skillsCount: 2,
            taskHistoryCount: 2,
            lastSyncedAt: '2026-07-05T00:00:00.000Z',
            degraded: false,
          },
        }}
      />,
    );

    expect(screen.getByText(/0 rebalance group/)).toBeInTheDocument();
    expect(screen.getByText(/No valid rebalance found/)).toBeInTheDocument();
  });

  it('renders degraded evidence warning', () => {
    render(
      <PmoRecommendRebalanceRenderer
        name="Recommend PMO Rebalance"
        state="output-available"
        output={{
          dateRange: { from: '2026-06-29', to: '2026-07-05' },
          members: [],
          recommendations: [],
          dataQuality: {
            recommendationDegraded: true,
            flags: ['candidate_data_unavailable'],
          },
          projectionFreshness: {
            skillsCount: 0,
            taskHistoryCount: 0,
            lastSyncedAt: null,
            degraded: true,
          },
        }}
      />,
    );

    expect(screen.getByText(/Candidate evidence degraded/)).toBeInTheDocument();
    expect(screen.getByText(/candidate data unavailable/)).toBeInTheDocument();
  });

  it('renders candidate card details', () => {
    render(
      <PmoRecommendRebalanceRenderer
        name="Recommend PMO Rebalance"
        state="output-available"
        output={candidateOutput()}
      />,
    );

    expect(screen.getByText('Source One')).toBeInTheDocument();
    expect(screen.getByText(/#1 Target Two/)).toBeInTheDocument();
    expect(screen.getByText(/PRJ-1/)).toBeInTheDocument();
    expect(screen.getByText('score 0.91')).toBeInTheDocument();
    expect(screen.getByText(/Matched: java, spring boot/)).toBeInTheDocument();
  });
});
