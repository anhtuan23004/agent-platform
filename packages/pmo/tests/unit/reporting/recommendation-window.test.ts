import { describe, expect, it } from 'vitest';
import {
  buildRecommendationWindow,
  nextWorkingDay,
} from '../../../src/backend/reporting/recommendations/index.ts';

describe('recommendation window', () => {
  it('skips weekends when computing planning start', () => {
    expect(nextWorkingDay(new Date('2026-08-08T00:00:00.000Z')).toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    );
    expect(nextWorkingDay(new Date('2026-08-09T00:00:00.000Z')).toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    );
    expect(nextWorkingDay(new Date('2026-08-10T00:00:00.000Z')).toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    );
  });

  it('builds a planning window from evidence dates', () => {
    const window = buildRecommendationWindow({
      evidenceFrom: new Date('2026-06-29T00:00:00.000Z'),
      evidenceTo: new Date('2026-08-07T00:00:00.000Z'),
    });
    expect(window.evidenceFrom.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(window.evidenceTo.toISOString()).toBe('2026-08-07T00:00:00.000Z');
    expect(window.planningStart.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(window.planningEnd).toBeNull();
  });
});
