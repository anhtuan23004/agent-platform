import { describe, expect, it } from 'vitest';
import {
  buildForwardAllocationWindow,
  nextWorkingDay,
} from '../../../src/backend/reporting/forward-allocation/window.ts';

describe('forward allocation window', () => {
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

  it('builds an 8-week planning window by default', () => {
    const window = buildForwardAllocationWindow({
      evidenceFrom: new Date('2026-06-29T00:00:00.000Z'),
      evidenceTo: new Date('2026-08-07T00:00:00.000Z'),
    });

    expect(window.evidenceFrom.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(window.evidenceTo.toISOString()).toBe('2026-08-07T00:00:00.000Z');
    expect(window.planningStart.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(window.planningEnd.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  it('accepts explicit planning boundaries', () => {
    const window = buildForwardAllocationWindow({
      evidenceFrom: new Date('2026-06-29T00:00:00.000Z'),
      evidenceTo: new Date('2026-08-07T00:00:00.000Z'),
      planningStart: new Date('2026-08-12T00:00:00.000Z'),
      planningEnd: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(window.planningStart.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(window.planningEnd.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });
});
