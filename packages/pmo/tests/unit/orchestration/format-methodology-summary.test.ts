import { describe, expect, it } from 'vitest';
import { formatMethodologySummary } from '../../../src/backend/orchestration/format-methodology-summary.ts';

describe('formatMethodologySummary', () => {
  it('renders plain-text formulas without LaTeX', () => {
    const summary = formatMethodologySummary({
      topic: 'busy_rate',
      formulas: {
        N01: 'busyRate = plannedHours / availableHours',
        memberBusyRate: 'sum(plannedHours) / sum(availableHours), excluding zero-capacity weeks',
      },
      thresholds: {
        overbookWarningAbove: 1.1,
        overbookRedAtOrAbove: 1.2,
        idleRedBelow: 0.75,
        idleWarningBelow: 0.85,
        mismatchPctThreshold: 0.2,
        otMaxHoursPerWeek: 10,
      },
      exclusions: ['Zero-capacity weeks are excluded from member-level busy aggregation.'],
      notes: ['Available hours account for holidays and approved absence.'],
    });

    expect(summary).toContain('busyRate = plannedHours / availableHours');
    expect(summary).toContain('sum(plannedHours) / sum(availableHours)');
    expect(summary).toContain('Overbook warning: above 110%');
    expect(summary).not.toMatch(/\\frac|\\text|\\\(/);
  });
});
