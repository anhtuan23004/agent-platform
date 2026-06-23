import type { ForwardAllocationWindow } from './contracts.ts';

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcWeeks(value: Date, weeks: number): Date {
  return addUtcDays(value, weeks * 7);
}

function isWeekend(value: Date): boolean {
  const day = value.getUTCDay();
  return day === 0 || day === 6;
}

export function nextWorkingDay(value: Date): Date {
  let cursor = startOfUtcDay(value);
  while (isWeekend(cursor)) {
    cursor = addUtcDays(cursor, 1);
  }
  return cursor;
}

export function buildForwardAllocationWindow(input: {
  evidenceFrom: Date;
  evidenceTo: Date;
  planningStart?: Date;
  planningEnd?: Date;
  horizonWeeks?: number;
}): ForwardAllocationWindow {
  const evidenceFrom = startOfUtcDay(input.evidenceFrom);
  const evidenceTo = startOfUtcDay(input.evidenceTo);
  const planningStart = input.planningStart
    ? startOfUtcDay(input.planningStart)
    : nextWorkingDay(addUtcDays(evidenceTo, 1));
  const planningEnd = input.planningEnd
    ? startOfUtcDay(input.planningEnd)
    : addUtcDays(addUtcWeeks(planningStart, input.horizonWeeks ?? 8), -1);

  return {
    evidenceFrom,
    evidenceTo,
    planningStart,
    planningEnd,
  };
}
