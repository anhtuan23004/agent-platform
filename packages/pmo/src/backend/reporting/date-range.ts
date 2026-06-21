import type { ReportDateRange } from './contracts.ts';

export interface ParsedReportDateRange {
  from: Date;
  to: Date;
  weekCount: number;
  normalized: ReportDateRange;
}

function parse(value: string, label: 'from' | 'to'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid_report_date:${label}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`invalid_report_date:${label}`);
  }
  return date;
}

export function validateReportDateRange(
  range: ReportDateRange,
  maxWeeks: number,
): ParsedReportDateRange {
  const from = parse(range.from, 'from');
  const to = parse(range.to, 'to');
  if (from > to) throw new Error('invalid_report_date_range');
  const inclusiveDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const weekCount = Math.ceil(inclusiveDays / 7);
  if (weekCount > maxWeeks) throw new Error(`report_date_range_exceeds_max_weeks:${maxWeeks}`);
  return { from, to, weekCount, normalized: { from: range.from, to: range.to } };
}
