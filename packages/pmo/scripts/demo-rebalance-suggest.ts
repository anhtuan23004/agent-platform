/**
 * Demo: skill-based swap proposals for overbook ↔ idle members (PMO_02 mock).
 *
 * Usage:
 *   node --experimental-strip-types packages/pmo/scripts/demo-rebalance-suggest.ts
 */

import {
  proposeRebalanceSwaps,
  rankRebalanceCandidates,
} from './lib/mock-member-skills-history.ts';
import {
  DEFAULT_MOCK_DB_PATH,
  loadAllocationsWithProjectsFromSqlite,
  loadMemberCapacitiesFromSqlite,
  loadMemberSkillsProfilesFromSqlite,
  loadMemberTaskHistoryEntriesFromSqlite,
} from './lib/mock-sqlite-canonical.ts';

const OVERBOOK = ['EMP-001', 'EMP-004'];
const IDLE = ['EMP-005', 'EMP-008', 'EMP-103', 'EMP-113'];

async function main(): Promise<void> {
  const profiles = loadMemberSkillsProfilesFromSqlite();
  const history = loadMemberTaskHistoryEntriesFromSqlite();
  const allocations = loadAllocationsWithProjectsFromSqlite();
  const capacities = loadMemberCapacitiesFromSqlite();

  // eslint-disable-next-line no-console
  console.log(`Loaded from ${DEFAULT_MOCK_DB_PATH}\n`);

  const swaps = proposeRebalanceSwaps({ profiles, history, allocations, capacities });
  // eslint-disable-next-line no-console
  console.log(`=== Swap proposals (${swaps.length} feasible) ===`);
  for (const s of swaps) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${s.from_member_id} → ${s.to_member_id}: ${s.transferable_hours}h/wk ${s.role} @ ${s.project_name} [fit=${s.skill_fit_score}]`,
    );
    // eslint-disable-next-line no-console
    console.log(`    ${s.rationale}`);
  }
  // eslint-disable-next-line no-console
  console.log('');

  for (const overbookId of OVERBOOK) {
    const source = profiles.find((p) => p.member_id === overbookId);
    if (!source) continue;

    const projects = [
      ...new Set(history.filter((h) => h.member_id === overbookId).map((h) => h.project_id)),
    ];

    const ranked = rankRebalanceCandidates({
      overbookMemberId: overbookId,
      candidateMemberIds: IDLE,
      profiles,
      history,
      overbookProjectIds: projects,
    }).filter((c) => c.can_swap);

    // eslint-disable-next-line no-console
    console.log(`── ${overbookId} (${source.role_title}) — swappable candidates only`);
    if (ranked.length === 0) {
      // eslint-disable-next-line no-console
      console.log('   (none — idle pool lacks same-role skill fit)');
    }
    for (const c of ranked) {
      // eslint-disable-next-line no-console
      console.log(
        `   ✓ ${c.member_id} ${c.full_name} [${c.matched_skills.join(', ')}] — ${c.rationale}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
