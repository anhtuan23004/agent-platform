import { Badge, Button, EmptyState } from '@seta/shared-ui';
import {
  AlertTriangle,
  CheckCircle2,
  type LucideIcon,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DemoFindingRow } from '../../api/demo-analytics.ts';
import { pct, ragBadge } from './formatters.tsx';
import { MetricHelpLabel } from './metric-help.tsx';
import { METRIC_HELP } from './metric-help-copy.ts';

export type FindingKindFilter = 'all' | 'overbook' | 'idle' | 'mismatch_under' | 'mismatch_over';

const KIND_FILTERS: Array<{ id: FindingKindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'overbook', label: 'Overbook' },
  { id: 'idle', label: 'Idle' },
  { id: 'mismatch_under', label: 'Underlog' },
  { id: 'mismatch_over', label: 'Overlog' },
];

function matchesKind(finding: DemoFindingRow, filter: FindingKindFilter): boolean {
  if (filter === 'all') return true;
  const type = finding.issueType.toLowerCase();
  if (filter === 'overbook') return type.includes('overbook');
  if (filter === 'idle')
    return type === 'idle' || (type.includes('idle') && !type.includes('overbook'));
  if (filter === 'mismatch_under')
    return type.includes('underlog') || type.includes('mismatch_under');
  if (filter === 'mismatch_over') return type.includes('overlog') || type.includes('mismatch_over');
  return true;
}

function issueMeta(issueType: string): {
  label: string;
  icon: LucideIcon;
  tone: 'warning' | 'danger' | 'secondary';
} {
  const normalized = issueType.toLowerCase();
  if (normalized.includes('overbook')) {
    return { label: issueType, icon: TrendingUp, tone: 'warning' };
  }
  if (normalized.includes('idle')) {
    return { label: issueType, icon: TrendingDown, tone: 'secondary' };
  }
  if (normalized.includes('mismatch')) {
    return { label: issueType, icon: AlertTriangle, tone: 'danger' };
  }
  return { label: issueType, icon: AlertTriangle, tone: 'secondary' };
}

function ragAccentClass(color: string): string {
  if (color === 'red') return 'border-l-danger bg-danger-tint/30';
  if (color === 'yellow') return 'border-l-warning bg-warning-tint/30';
  if (color === 'green') return 'border-l-success bg-success-tint/30';
  return 'border-l-hairline-strong bg-surface-1';
}

function FindingCard({
  finding,
  getMemberLabel,
}: {
  finding: DemoFindingRow;
  getMemberLabel: (id: string) => string;
}) {
  const meta = issueMeta(finding.issueType);

  return (
    <article
      className={`rounded-lg border border-hairline border-l-4 px-4 py-3 shadow-sm ${ragAccentClass(finding.ragColor)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="font-mono text-body-sm font-semibold text-ink">
            {getMemberLabel(finding.memberId)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                meta.tone === 'danger'
                  ? 'destructive'
                  : meta.tone === 'warning'
                    ? 'warning'
                    : 'secondary'
              }
              className="gap-1"
            >
              <meta.icon className="size-3" />
              {meta.label}
            </Badge>
            {ragBadge(finding.ragColor)}
          </div>
        </div>
        <dl className="flex shrink-0 gap-4 text-right text-caption">
          <div>
            <dt className="flex justify-end">
              <MetricHelpLabel help={METRIC_HELP.busyRate} className="font-medium">
                Busy
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">{pct(finding.busyRate)}</dd>
          </div>
          <div>
            <dt className="flex justify-end">
              <MetricHelpLabel help={METRIC_HELP.effortConsumption} className="font-medium">
                EC
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {pct(finding.effortConsumption)}
            </dd>
          </div>
        </dl>
      </div>

      {finding.detail ? (
        <p className="mt-3 text-body-sm leading-relaxed text-ink">{finding.detail}</p>
      ) : null}

      {finding.excludedWeeks.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetricHelpLabel help={METRIC_HELP.excludedWeeks} className="text-caption font-medium">
            Excluded weeks
          </MetricHelpLabel>
          {finding.excludedWeeks.map((week) => (
            <span
              key={`${finding.memberId}-${week.weekId}`}
              className="rounded-md border border-hairline-strong bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-muted"
            >
              {week.weekId}
              <span className="text-ink-muted"> · {week.reason}</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function FindingGroup({
  title,
  description,
  findings,
  getMemberLabel,
  emptyTitle,
}: {
  title: string;
  description: string;
  findings: DemoFindingRow[];
  getMemberLabel: (id: string) => string;
  emptyTitle: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-body font-semibold text-ink">{title}</h3>
          <p className="text-body-sm text-ink-muted">{description}</p>
        </div>
        <Badge variant={findings.length > 0 ? 'warning' : 'success'}>
          {findings.length} flagged
        </Badge>
      </div>

      {findings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-canvas px-4 py-8">
          <EmptyState
            icon={<CheckCircle2 className="size-8 text-success" />}
            title={emptyTitle}
            description="No members matched this rule for the current filter."
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => (
            <li key={`${finding.memberId}-${finding.issueType}`}>
              <FindingCard finding={finding} getMemberLabel={getMemberLabel} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingKindFilterBar({
  kindFilter,
  onKindFilterChange,
  counts,
}: {
  kindFilter: FindingKindFilter;
  onKindFilterChange: (next: FindingKindFilter) => void;
  counts: Record<FindingKindFilter, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-canvas px-3 py-2 shadow-sm">
      <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">
        Issue type
      </span>
      {KIND_FILTERS.map((item) => {
        const active = kindFilter === item.id;
        const count = counts[item.id];
        return (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={active ? 'default' : 'secondary'}
            onClick={() => onKindFilterChange(item.id)}
            className="gap-1.5"
          >
            {item.label}
            <span
              className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold ${
                active
                  ? 'border-on-primary/25 bg-on-primary/20 text-on-primary'
                  : 'border-hairline-strong bg-surface-2 text-ink'
              }`}
            >
              {count}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

interface DemoCalculationFindingsPanelProps {
  overbookIdle: DemoFindingRow[];
  mismatch: DemoFindingRow[];
  getMemberLabel: (id: string) => string;
}

export function DemoCalculationFindingsPanel({
  overbookIdle,
  mismatch,
  getMemberLabel,
}: DemoCalculationFindingsPanelProps) {
  const [kindFilter, setKindFilter] = useState<FindingKindFilter>('all');

  const allFindings = useMemo(() => [...overbookIdle, ...mismatch], [overbookIdle, mismatch]);

  const counts = useMemo(() => {
    const tally = {
      all: allFindings.length,
      overbook: 0,
      idle: 0,
      mismatch_under: 0,
      mismatch_over: 0,
    } satisfies Record<FindingKindFilter, number>;
    for (const finding of allFindings) {
      if (matchesKind(finding, 'overbook')) tally.overbook++;
      if (matchesKind(finding, 'idle')) tally.idle++;
      if (matchesKind(finding, 'mismatch_under')) tally.mismatch_under++;
      if (matchesKind(finding, 'mismatch_over')) tally.mismatch_over++;
    }
    return tally;
  }, [allFindings]);

  const filteredOverbookIdle = useMemo(
    () => overbookIdle.filter((f) => matchesKind(f, kindFilter)),
    [overbookIdle, kindFilter],
  );

  const filteredMismatch = useMemo(
    () => mismatch.filter((f) => matchesKind(f, kindFilter)),
    [mismatch, kindFilter],
  );

  const filteredAll = useMemo(
    () => allFindings.filter((f) => matchesKind(f, kindFilter)),
    [allFindings, kindFilter],
  );

  const total = allFindings.length;
  const visibleCount = kindFilter === 'all' ? total : filteredAll.length;

  return (
    <div className="space-y-4">
      {total > 0 ? (
        <FindingKindFilterBar
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          counts={counts}
        />
      ) : null}

      {total === 0 ? (
        <div className="rounded-xl border border-hairline bg-canvas px-6 py-10 shadow-sm">
          <EmptyState
            icon={<CheckCircle2 className="size-10 text-success" />}
            title="No utilization findings"
            description="All delivery members are within configured overbook, idle, and mismatch thresholds."
          />
        </div>
      ) : visibleCount === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-canvas px-6 py-10">
          <EmptyState
            icon={<CheckCircle2 className="size-8 text-ink-subtle" />}
            title="No findings for this type"
            description="Try another issue type or clear member/project filters."
          />
        </div>
      ) : kindFilter === 'all' ? (
        <div className="grid gap-8 xl:grid-cols-2">
          <FindingGroup
            title="Overbook & idle"
            description="Busy rate above overbook threshold, or below idle threshold."
            findings={filteredOverbookIdle}
            getMemberLabel={getMemberLabel}
            emptyTitle="No overbook or idle issues"
          />
          <FindingGroup
            title="Logged vs planned"
            description="Effort consumption outside the allowed mismatch band."
            findings={filteredMismatch}
            getMemberLabel={getMemberLabel}
            emptyTitle="No mismatch issues"
          />
        </div>
      ) : (
        <FindingGroup
          title={KIND_FILTERS.find((f) => f.id === kindFilter)?.label ?? 'Findings'}
          description="Filtered utilization findings for the selected issue type."
          findings={filteredAll}
          getMemberLabel={getMemberLabel}
          emptyTitle="No findings for this type"
        />
      )}
    </div>
  );
}
