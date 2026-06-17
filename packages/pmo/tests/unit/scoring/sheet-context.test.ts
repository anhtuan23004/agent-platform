import { describe, expect, it } from 'vitest';
import { getCanonicalTable } from '../../../src/backend/ingestion/canonical-schema.ts';
import type { SheetRoleCandidate } from '../../../src/backend/ingestion/detect-sheet-role.ts';
import { scoreSheetContext } from '../../../src/backend/ingestion/scoring/sheet-context.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getField(tableId: string, fieldName: string) {
  return getCanonicalTable(tableId)!.fields.find((f) => f.name === fieldName)!;
}

function makeRole(candidateRole: string, confidence: number): SheetRoleCandidate {
  return { candidateRole, confidence, evidence: [] };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('scoreSheetContext', () => {
  it('timesheet sheet + logged_hours → high score', () => {
    const score = scoreSheetContext(
      makeRole('timesheet', 0.95),
      getField('timesheet', 'logged_hours'),
    );
    expect(score).toBeCloseTo(0.95, 1);
  });

  it('timesheet sheet + allocation_pct → low score', () => {
    const score = scoreSheetContext(
      makeRole('timesheet', 0.95),
      getField('resource_allocation', 'allocation_pct'),
    );
    expect(score).toBeLessThanOrEqual(0.3);
  });

  it('RA sheet + allocation_pct → high score', () => {
    const score = scoreSheetContext(
      makeRole('resource_allocation', 0.95),
      getField('resource_allocation', 'allocation_pct'),
    );
    expect(score).toBeCloseTo(0.95, 1);
  });

  it('RA sheet + logged_hours → low score', () => {
    const score = scoreSheetContext(
      makeRole('resource_allocation', 0.95),
      getField('timesheet', 'logged_hours'),
    );
    expect(score).toBeLessThanOrEqual(0.3);
  });

  it('low confidence sheet role reduces score proportionally', () => {
    const highConf = scoreSheetContext(
      makeRole('timesheet', 0.95),
      getField('timesheet', 'logged_hours'),
    );
    const lowConf = scoreSheetContext(
      makeRole('timesheet', 0.4),
      getField('timesheet', 'logged_hours'),
    );
    expect(lowConf).toBeLessThan(highConf);
    expect(lowConf).toBeCloseTo(0.4, 1);
  });

  it('member_master sheet + member_id → high score', () => {
    const score = scoreSheetContext(
      makeRole('member_master', 0.9),
      getField('member_master', 'member_id'),
    );
    expect(score).toBeCloseTo(0.9, 1);
  });

  it('cross-table field in role matrix → low score', () => {
    // allocation_pct belongs to resource_allocation, not calendar_weeks → penalized
    const score = scoreSheetContext(
      makeRole('calendar_weeks', 0.9),
      getField('resource_allocation', 'allocation_pct'),
    );
    // Field from another table → 0.1 × 0.9 = 0.09
    expect(score).toBeLessThanOrEqual(0.15);
  });

  it('leave sheet + leave_type → high score', () => {
    const score = scoreSheetContext(makeRole('leave', 0.9), getField('leave', 'leave_type'));
    expect(score).toBeCloseTo(0.9, 1);
  });
});
