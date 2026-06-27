import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';

function readCsv(file: string): Array<Record<string, string>> {
  const root = path.resolve(__dirname, '../../../../..');
  const raw = fs.readFileSync(path.join(root, 'hackathon/data', file), 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

describe('recommendation fixture minimum scenarios', () => {
  it('includes EMP-004 and ranked top-3 BE golden rows for PRJ-001', () => {
    const profiles = readCsv('pmo_02_member_profiles.csv');
    const swaps = readCsv('pmo_02_rebalance_swaps.csv');

    expect(profiles.some((row) => row.member_id === 'EMP-004')).toBe(true);
    expect(profiles.some((row) => row.member_id === 'EMP-103')).toBe(true);
    expect(profiles.some((row) => row.member_id === 'EMP-113')).toBe(true);
    expect(profiles.some((row) => row.member_id === 'EMP-119')).toBe(true);

    const emp004Prj001 = swaps
      .filter(
        (row) =>
          row.source_member_id === 'EMP-004' &&
          row.project_id === 'PRJ-001' &&
          row.can_swap === 'true',
      )
      .sort((left, right) => Number(left.expected_rank) - Number(right.expected_rank));

    expect(emp004Prj001.map((row) => row.target_member_id)).toEqual([
      'EMP-103',
      'EMP-113',
      'EMP-119',
    ]);
    expect(emp004Prj001.map((row) => row.expected_rank)).toEqual(['1', '2', '3']);
    expect(emp004Prj001.every((row) => row.effective_from === '2026-08-10')).toBe(true);
  });

  it('contains overload rejection and degraded candidate evidence', () => {
    const swaps = readCsv('pmo_02_rebalance_swaps.csv');
    const history = readCsv('pmo_02_member_task_history.csv');

    expect(
      swaps.some(
        (row) =>
          row.source_member_id === 'EMP-004' &&
          row.target_member_id === 'EMP-120' &&
          row.project_id === 'PRJ-001' &&
          row.can_swap === 'false',
      ),
    ).toBe(true);

    const degraded = swaps.find(
      (row) =>
        row.source_member_id === 'EMP-004' &&
        row.target_member_id === 'EMP-119' &&
        row.project_id === 'PRJ-001',
    );
    expect(degraded?.expected_confidence).toBe('low');
    expect(degraded?.rationale?.toLowerCase()).toContain('degrade');

    const emp119History = history.filter((row) => row.member_id === 'EMP-119');
    expect(emp119History.length).toBeGreaterThan(0);
    expect(emp119History.every((row) => row.embedding_text === '')).toBe(true);
    expect(emp119History.every((row) => row.embedding_source_hash === '')).toBe(true);

    const emp103Orion = history.filter(
      (row) => row.member_id === 'EMP-103' && row.project_id === 'PRJ-001',
    );
    expect(emp103Orion.length).toBeGreaterThan(0);
    expect(emp103Orion.every((row) => row.embedding_source_hash !== '')).toBe(true);
  });

  it('includes a design-aligned recommendation path for EMP-118', () => {
    const swaps = readCsv('pmo_02_rebalance_swaps.csv');

    const emp118Design = swaps
      .filter(
        (row) =>
          row.source_member_id === 'EMP-118' &&
          row.project_id === 'PRJ-101' &&
          row.can_swap === 'true',
      )
      .sort((left, right) => Number(left.expected_rank) - Number(right.expected_rank));

    expect(emp118Design.map((row) => row.target_member_id)).toEqual(['EMP-115', 'EMP-114']);
    expect(emp118Design.every((row) => row.role === 'Design')).toBe(true);
    expect(emp118Design.every((row) => row.effective_from === '2026-08-10')).toBe(true);
  });
});
