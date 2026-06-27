import { describe, expect, it } from 'vitest';
import { tuneRecommendationHistoryRows } from '../../../src/backend/demo/tune-recommendation-history.ts';

const swaps = [
  {
    source_member_id: 'EMP-004',
    target_member_id: 'EMP-103',
    project_id: 'PRJ-001',
    role: 'BE',
    expected_rank: '1',
    expected_confidence: 'high',
    can_swap: 'true',
  },
  {
    source_member_id: 'EMP-004',
    target_member_id: 'EMP-119',
    project_id: 'PRJ-001',
    role: 'BE',
    expected_rank: '3',
    expected_confidence: 'low',
    can_swap: 'true',
    rationale: 'embeddings are unavailable so confidence should degrade',
  },
];

const baseRows = [
  {
    history_id: 'EMP-004-PRJ-001-api-endpoint-implementation',
    member_id: 'EMP-004',
    project_id: 'PRJ-001',
    project_name: 'Project Orion (Core Banking)',
    project_type: 'Software/Migration',
    allocation_role: 'BE',
    task_title: 'API endpoint implementation',
    task_summary: 'Build and test REST APIs for core services',
    total_logged_hours: '65.1',
    skill_tags: 'java|spring-boot',
    embedding_text: 'API endpoint implementation | Build and test REST APIs',
    embedding_source_hash: 'hash-source',
  },
];

describe('tuneRecommendationHistoryRows', () => {
  it('injects swap-aligned PRJ-001 history for top-ranked candidates', () => {
    const tuned = tuneRecommendationHistoryRows({
      rows: baseRows,
      swaps,
      fallbackCompletedAt: () => '2026-07-01',
    });

    const emp103 = tuned.filter(
      (row) => row.member_id === 'EMP-103' && row.project_id === 'PRJ-001',
    );
    expect(emp103).toHaveLength(1);
    expect(emp103[0]?.completed_at).toBe('2026-08-06T17:00:00.000Z');
    expect(emp103[0]?.embedding_source_hash).toBe('hash-source');
  });

  it('keeps degraded candidates on the project but strips embeddings', () => {
    const tuned = tuneRecommendationHistoryRows({
      rows: baseRows,
      swaps,
      fallbackCompletedAt: () => '2026-07-01',
    });

    const emp119 = tuned.filter(
      (row) => row.member_id === 'EMP-119' && row.project_id === 'PRJ-001',
    );
    expect(emp119).toHaveLength(1);
    expect(emp119[0]?.embedding_text).toBe('');
    expect(emp119[0]?.embedding_source_hash).toBe('');
    expect(emp119[0]?.completed_at).toBe('2026-07-23T17:00:00.000Z');
  });
});
