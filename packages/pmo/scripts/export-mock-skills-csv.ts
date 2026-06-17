/**
 * Export PMO_02 mock member skills + task history from `mock-data.db` to CSV.
 *
 * Usage:
 *   node --experimental-strip-types packages/pmo/scripts/export-mock-skills-csv.ts
 */

import { exportMockSkillsCsv } from './lib/export-mock-skills-csv.ts';

const result = exportMockSkillsCsv();

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      ok: true,
      files: {
        member_skills: result.memberSkillsPath,
        member_task_history: result.memberTaskHistoryPath,
        member_profiles: result.memberProfilesPath,
        rebalance_swaps: result.rebalanceSwapsPath,
      },
      rows: {
        member_skills: result.memberSkillRows,
        member_task_history: result.taskHistoryRows,
        member_profiles: result.memberProfileRows,
        rebalance_swaps: result.rebalanceSwapRows,
      },
    },
    null,
    2,
  ),
);
