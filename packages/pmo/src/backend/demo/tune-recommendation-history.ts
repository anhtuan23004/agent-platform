export interface RecommendationHistoryRow {
  history_id: string;
  member_id: string;
  project_id: string;
  project_name: string;
  project_type: string;
  allocation_role: string;
  task_title: string;
  task_summary: string;
  total_logged_hours: string;
  skill_tags: string;
  completed_at?: string;
  embedding_text?: string;
  embedding_source_hash?: string;
  [key: string]: string | undefined;
}

export interface RebalanceSwapRow {
  source_member_id: string;
  target_member_id: string;
  project_id: string;
  role: string;
  expected_rank?: string;
  expected_confidence?: string;
  can_swap?: string;
  rationale?: string;
}

const RANGE_START = new Date('2026-06-29T00:00:00.000Z');

function cloneRow(
  source: RecommendationHistoryRow,
  overrides: Partial<RecommendationHistoryRow>,
): RecommendationHistoryRow {
  return { ...source, ...overrides };
}

function slugTaskId(taskTitle: string): string {
  return taskTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Evidence `to` is start-of-day on the last Friday; rank-1 must finish before that instant. */
function completedAtForRank(rank: number): string {
  const dayOffset = rank === 1 ? 38 : rank === 2 ? 32 : rank === 3 ? 24 : 16;
  const date = new Date(RANGE_START);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.toISOString().slice(0, 10)}T17:00:00.000Z`;
}

function bestSwapRank(
  swaps: RebalanceSwapRow[],
  memberId: string,
  projectId: string,
): number | null {
  const ranks = swaps
    .filter(
      (swap) =>
        swap.target_member_id === memberId &&
        swap.project_id === projectId &&
        swap.can_swap === 'true' &&
        swap.expected_rank,
    )
    .map((swap) => Number(swap.expected_rank))
    .filter((rank) => Number.isFinite(rank));
  if (ranks.length === 0) return null;
  return Math.min(...ranks);
}

function membersWithoutEmbeddings(swaps: RebalanceSwapRow[]): Set<string> {
  return new Set(
    swaps
      .filter(
        (swap) =>
          swap.expected_confidence === 'low' && swap.rationale?.toLowerCase().includes('embedding'),
      )
      .map((swap) => swap.target_member_id),
  );
}

function injectSwapAlignedRows(
  rows: RecommendationHistoryRow[],
  swaps: RebalanceSwapRow[],
): RecommendationHistoryRow[] {
  const existingIds = new Set(rows.map((row) => row.history_id));
  const injected: RecommendationHistoryRow[] = [];

  for (const swap of swaps) {
    if (swap.can_swap !== 'true' || !swap.expected_rank) continue;

    const rank = Number(swap.expected_rank);
    if (!Number.isFinite(rank)) continue;

    const sourceRows = rows.filter(
      (row) =>
        row.member_id === swap.source_member_id &&
        row.project_id === swap.project_id &&
        row.allocation_role === swap.role,
    );
    if (sourceRows.length === 0) continue;

    const alreadyOnProject = rows.some(
      (row) => row.member_id === swap.target_member_id && row.project_id === swap.project_id,
    );
    if (alreadyOnProject) continue;

    const hoursScale = rank === 1 ? 1.05 : rank === 2 ? 0.88 : 0.72;
    for (const sourceRow of sourceRows) {
      const historyId = `${swap.target_member_id}-${swap.project_id}-${slugTaskId(sourceRow.task_title)}`;
      if (existingIds.has(historyId)) continue;

      const loggedHours = Math.round(Number(sourceRow.total_logged_hours) * hoursScale * 10) / 10;
      injected.push(
        cloneRow(sourceRow, {
          history_id: historyId,
          member_id: swap.target_member_id,
          project_id: swap.project_id,
          project_name: sourceRow.project_name,
          total_logged_hours: String(loggedHours),
          completed_at: completedAtForRank(rank),
          embedding_text: rank === 1 ? sourceRow.embedding_text : sourceRow.embedding_text,
          embedding_source_hash:
            rank === 1 ? sourceRow.embedding_source_hash : sourceRow.embedding_source_hash,
        }),
      );
      existingIds.add(historyId);
    }
  }

  return [...rows, ...injected];
}

export function tuneRecommendationHistoryRows(input: {
  rows: RecommendationHistoryRow[];
  swaps: RebalanceSwapRow[];
  fallbackCompletedAt: (historyId: string) => string;
}): RecommendationHistoryRow[] {
  const withoutEmbeddings = membersWithoutEmbeddings(input.swaps);
  const withInjected = injectSwapAlignedRows(input.rows, input.swaps);

  return withInjected.map((row) => {
    const rank = bestSwapRank(input.swaps, row.member_id, row.project_id);
    const completedAt =
      rank !== null
        ? completedAtForRank(rank)
        : `${input.fallbackCompletedAt(row.history_id)}T17:00:00.000Z`;

    if (withoutEmbeddings.has(row.member_id)) {
      return {
        ...row,
        completed_at: completedAt,
        embedding_text: '',
        embedding_source_hash: '',
      };
    }

    return {
      ...row,
      completed_at: completedAt,
    };
  });
}
