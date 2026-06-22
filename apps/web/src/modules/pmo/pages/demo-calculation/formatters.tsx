import { Badge } from '@seta/shared-ui';
import type { ReactNode } from 'react';

export function hours(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(digits);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function ragBadge(color: string) {
  const variant =
    color === 'red'
      ? 'destructive'
      : color === 'yellow'
        ? 'warning'
        : color === 'green'
          ? 'success'
          : 'secondary';
  return <Badge variant={variant}>{color}</Badge>;
}

export function projectStatusBadge(status: string | null | undefined) {
  if (!status) return <span className="text-ink-subtle">—</span>;
  const normalized = status.trim().toLowerCase();
  const variant =
    normalized === 'active' ? 'success' : normalized === 'completed' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{status}</Badge>;
}

export function reasonBadge(reason: string | null) {
  if (!reason) return <span className="text-ink-subtle">—</span>;
  const label =
    reason === 'no_plan'
      ? 'No plan'
      : reason === 'pre_hire'
        ? 'Pre-hire'
        : reason === 'holiday_week'
          ? 'Holiday week'
          : reason === 'approved_leave'
            ? 'Approved leave'
            : reason === 'approved_ot'
              ? 'Approved OT'
              : reason === 'training'
                ? 'Training'
                : reason;
  const variant =
    reason === 'no_plan' || reason === 'pre_hire'
      ? 'secondary'
      : reason === 'holiday_week'
        ? 'outline'
        : 'warning';
  return <Badge variant={variant}>{label}</Badge>;
}

export function excludedCell(weeks: Array<{ weekId: string; reason: string }>) {
  return weeks.length > 0 ? weeks.map((w) => `${w.weekId} (${w.reason})`).join(', ') : '—';
}

export function nullish(v: string | null | undefined): ReactNode {
  return v == null || v === '' ? <span className="text-ink-subtle">—</span> : v;
}
