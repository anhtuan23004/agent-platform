import type { RecommendationWindow } from './contracts.ts';

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
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

export function buildRecommendationWindow(input: {
  evidenceFrom: Date;
  evidenceTo: Date;
  planningEnd?: Date | null;
}): RecommendationWindow {
  return {
    evidenceFrom: startOfUtcDay(input.evidenceFrom),
    evidenceTo: startOfUtcDay(input.evidenceTo),
    planningStart: nextWorkingDay(addUtcDays(input.evidenceTo, 1)),
    planningEnd: input.planningEnd ? startOfUtcDay(input.planningEnd) : null,
  };
}
