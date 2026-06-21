import { describe, expect, it } from 'vitest';
import {
  buildFindingSuggestedActions,
  buildSuggestedActionCode,
  buildSuggestedActions,
} from '../../../src/backend/analytics/findings.ts';
import {
  PMO_ACTION_CODES,
  PMO_ACTION_TEMPLATES,
  type PmoActionCode,
} from '../../../src/backend/analytics/types.ts';

describe('PMO action codes', () => {
  it('maps every issue type to a typed action code', () => {
    expect(buildSuggestedActionCode('overbook')).toBe('REBALANCE_ALLOCATION');
    expect(buildSuggestedActionCode('idle')).toBe('REVIEW_WITH_LINE_MANAGER');
    expect(buildSuggestedActionCode('mismatch_under')).toBe('CHECK_MISSING_TIMESHEET');
    expect(buildSuggestedActionCode('mismatch_over')).toBe('REVIEW_RA_TIMESHEET_MISMATCH');
    expect(buildSuggestedActionCode('ok')).toBe('NO_ACTION');
  });

  it('deduplicates action codes across issue types', () => {
    expect(buildSuggestedActions(['overbook', 'overbook', 'mismatch_under'])).toEqual([
      'REBALANCE_ALLOCATION',
      'CHECK_MISSING_TIMESHEET',
    ]);
  });

  it('every action code has a non-empty template text', () => {
    for (const code of Object.values(PMO_ACTION_CODES)) {
      expect(PMO_ACTION_TEMPLATES[code]).toBeTruthy();
      expect(PMO_ACTION_TEMPLATES[code].length).toBeGreaterThan(10);
    }
  });

  it('template text is deterministic and LLM-independent', () => {
    const first = PMO_ACTION_TEMPLATES.REBALANCE_ALLOCATION;
    const second = PMO_ACTION_TEMPLATES.REBALANCE_ALLOCATION;
    expect(first).toBe(second);
    expect(first).toContain('redistributing hours');
  });
});

describe('buildFindingSuggestedActions', () => {
  it('returns primary action without annotations', () => {
    const actions = buildFindingSuggestedActions('overbook', []);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionCode: 'REBALANCE_ALLOCATION',
      primary: true,
    });
    expect(actions[0]!.templateText).toBeTruthy();
  });

  it('returns primary action for idle without annotations', () => {
    const actions = buildFindingSuggestedActions('idle', []);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionCode: 'REVIEW_WITH_LINE_MANAGER',
      primary: true,
    });
  });

  it('appends CONFIRM_APPROVED_OT when approved_ot annotation present', () => {
    const actions = buildFindingSuggestedActions('overbook', [
      { weekId: 'W1', reason: 'approved_ot' },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ actionCode: 'REBALANCE_ALLOCATION', primary: true });
    expect(actions[1]).toMatchObject({ actionCode: 'CONFIRM_APPROVED_OT', primary: false });
    expect(actions[1]!.templateText).toContain('Overtime hours detected');
  });

  it('appends VALIDATE_TRAINING_TIME when training annotation present', () => {
    const actions = buildFindingSuggestedActions('idle', [{ weekId: 'W1', reason: 'training' }]);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ actionCode: 'REVIEW_WITH_LINE_MANAGER', primary: true });
    expect(actions[1]).toMatchObject({ actionCode: 'VALIDATE_TRAINING_TIME', primary: false });
    expect(actions[1]!.templateText).toContain('Training hours recorded');
  });

  it('appends both annotation-driven actions when both present', () => {
    const actions = buildFindingSuggestedActions('overbook', [
      { weekId: 'W1', reason: 'approved_ot' },
      { weekId: 'W2', reason: 'training' },
    ]);
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.actionCode)).toEqual([
      'REBALANCE_ALLOCATION',
      'CONFIRM_APPROVED_OT',
      'VALIDATE_TRAINING_TIME',
    ]);
    expect(actions[0]!.primary).toBe(true);
    expect(actions[1]!.primary).toBe(false);
    expect(actions[2]!.primary).toBe(false);
  });

  it('deduplicates annotations from multiple weeks', () => {
    const actions = buildFindingSuggestedActions('overbook', [
      { weekId: 'W1', reason: 'approved_ot' },
      { weekId: 'W2', reason: 'approved_ot' },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.actionCode)).toEqual([
      'REBALANCE_ALLOCATION',
      'CONFIRM_APPROVED_OT',
    ]);
  });

  it('maps mismatch_under to CHECK_MISSING_TIMESHEET', () => {
    const actions = buildFindingSuggestedActions('mismatch_under', []);
    expect(actions[0]).toMatchObject({ actionCode: 'CHECK_MISSING_TIMESHEET', primary: true });
    expect(actions[0]!.templateText).toContain('Logged hours are significantly below');
  });

  it('maps mismatch_over to REVIEW_RA_TIMESHEET_MISMATCH', () => {
    const actions = buildFindingSuggestedActions('mismatch_over', []);
    expect(actions[0]).toMatchObject({
      actionCode: 'REVIEW_RA_TIMESHEET_MISMATCH',
      primary: true,
    });
    expect(actions[0]!.templateText).toContain('Logged hours exceed planned');
  });

  it('PMO_ACTION_CODES is exhaustive with 7 entries', () => {
    const codes = Object.values(PMO_ACTION_CODES);
    expect(codes).toHaveLength(7);
    expect(codes).toContain('REBALANCE_ALLOCATION');
    expect(codes).toContain('REVIEW_WITH_LINE_MANAGER');
    expect(codes).toContain('CHECK_MISSING_TIMESHEET');
    expect(codes).toContain('CONFIRM_APPROVED_OT');
    expect(codes).toContain('VALIDATE_TRAINING_TIME');
    expect(codes).toContain('REVIEW_RA_TIMESHEET_MISMATCH');
    expect(codes).toContain('NO_ACTION');
  });

  it('PMO_ACTION_TEMPLATES covers all action codes', () => {
    const codeValues = Object.values(PMO_ACTION_CODES) as PmoActionCode[];
    const templateKeys = Object.keys(PMO_ACTION_TEMPLATES) as PmoActionCode[];
    expect(new Set(templateKeys)).toEqual(new Set(codeValues));
  });
});
