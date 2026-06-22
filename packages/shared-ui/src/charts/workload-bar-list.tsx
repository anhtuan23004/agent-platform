import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';

export interface WorkloadBarRow {
  key: string;
  label: string;
  /** 0–100+; bar width is relative to `scaleMax`. */
  value: number;
  color?: string;
  /** Optional second line under the label (e.g. member id). */
  hint?: string;
}

export interface WorkloadBarListProps {
  rows: WorkloadBarRow[];
  /** Bar track scales to this maximum (defaults to max row value or 100). */
  scaleMax?: number;
  assigneeColumnLabel?: string;
  distributionColumnLabel?: string;
  selectedKey?: string | null;
  onRowClick?: (row: WorkloadBarRow) => void;
  emptyMessage?: string;
  /** Collapse to this many rows with a "show more" control. */
  maxVisible?: number;
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function resolveScaleMax(rows: WorkloadBarRow[], scaleMax?: number): number {
  if (scaleMax !== undefined && scaleMax > 0) return scaleMax;
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
  return Math.max(100, Math.ceil(peak / 10) * 10);
}

function resolveVisibleRows(
  rows: WorkloadBarRow[],
  maxVisible: number | undefined,
  expanded: boolean,
  selectedKey?: string | null,
): WorkloadBarRow[] {
  if (!maxVisible || expanded || rows.length <= maxVisible) return rows;
  const head = rows.slice(0, maxVisible);
  if (!selectedKey || head.some((row) => row.key === selectedKey)) return head;
  const selected = rows.find((row) => row.key === selectedKey);
  if (!selected) return head;
  return [...head.slice(0, maxVisible - 1), selected];
}

/** Jira-style assignee list with horizontal workload bars. */
export function WorkloadBarList({
  rows,
  scaleMax,
  assigneeColumnLabel = 'Assignee',
  distributionColumnLabel = 'Work distribution',
  selectedKey,
  onRowClick,
  emptyMessage = 'No rows to display.',
  maxVisible,
}: WorkloadBarListProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = useMemo(
    () => resolveVisibleRows(rows, maxVisible, expanded, selectedKey),
    [rows, maxVisible, expanded, selectedKey],
  );
  const hiddenCount =
    maxVisible && !expanded && rows.length > maxVisible ? rows.length - maxVisible : 0;

  if (rows.length === 0) {
    return <p className="text-body-sm text-ink-subtle">{emptyMessage}</p>;
  }

  const max = resolveScaleMax(rows, scaleMax);
  const clickable = Boolean(onRowClick);

  return (
    <div className="min-w-0">
      <div className="mb-2 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] gap-3 px-1 text-caption font-medium text-ink-subtle">
        <span>{assigneeColumnLabel}</span>
        <span>{distributionColumnLabel}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {visibleRows.map((row) => {
          const widthPct = Math.min(100, Math.max(0, (row.value / max) * 100));
          const showLabelInBar = widthPct >= 18;
          const fill = row.color ?? 'var(--color-primary)';
          const selected = selectedKey === row.key;

          const content = (
            <>
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink-muted"
                >
                  {initials(row.label)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-ink">{row.label}</p>
                  {row.hint ? (
                    <p className="truncate text-caption text-ink-subtle">{row.hint}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-200"
                    style={{ width: `${widthPct}%`, background: fill }}
                  />
                  {showLabelInBar ? (
                    <span className="relative z-[1] flex h-full items-center px-2 text-caption font-semibold tabular-nums text-ink">
                      {Math.round(row.value * 10) / 10}%
                    </span>
                  ) : null}
                </div>
                {!showLabelInBar ? (
                  <span className="w-12 shrink-0 text-right text-caption font-medium tabular-nums text-ink">
                    {Math.round(row.value * 10) / 10}%
                  </span>
                ) : null}
              </div>
            </>
          );

          return (
            <li key={row.key}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    'grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] items-center gap-3 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-surface-1',
                    selected && 'bg-primary-tint ring-1 ring-primary-border',
                  )}
                >
                  {content}
                </button>
              ) : (
                <div
                  className={cn(
                    'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] items-center gap-3 rounded-md px-1 py-1.5',
                    selected && 'bg-primary-tint ring-1 ring-primary-border',
                  )}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mt-2 text-caption font-medium text-primary hover:underline"
          onClick={() => setExpanded(true)}
        >
          Show {hiddenCount} more
        </button>
      ) : null}
      {expanded && maxVisible && rows.length > maxVisible ? (
        <button
          type="button"
          className="mt-2 text-caption font-medium text-primary hover:underline"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      ) : null}
    </div>
  );
}
