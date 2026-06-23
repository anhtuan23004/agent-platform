import { ragAccentClass } from './finding-metadata.ts';
import { hours, nullish, pct } from './formatters.tsx';
import { IssueBadge } from './issue-badge.tsx';
import { MetricHelpLabel } from './metric-help.tsx';
import { METRIC_HELP } from './metric-help-copy.ts';
import type { MemberDrilldownSummary } from './utilization-charts.logic.ts';

export function MemberDrilldownCard({ summary }: { summary: MemberDrilldownSummary }) {
  return (
    <article
      className={`rounded-lg border border-hairline border-l-4 px-4 py-4 shadow-sm ${ragAccentClass(summary.ragColor)}`}
      data-testid="member-drilldown-card"
    >
      <div className="space-y-3">
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink">{summary.label}</p>
          <p className="font-mono text-caption text-ink-subtle">{summary.memberId}</p>
          <p className="mt-1 text-body-sm text-ink-muted">
            {nullish(summary.roleTitle)}
            {summary.stdHoursWeek != null ? (
              <span>
                {summary.roleTitle ? ' · ' : ''}
                {summary.stdHoursWeek}h/wk std
              </span>
            ) : null}
          </p>
        </div>

        <IssueBadge issueType={summary.issueType} ragColor={summary.ragColor} />

        <dl className="grid grid-cols-3 gap-3 text-caption">
          <div>
            <dt>
              <MetricHelpLabel help={METRIC_HELP.busyRate} className="font-medium">
                Busy
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">{pct(summary.busyRate)}</dd>
          </div>
          <div>
            <dt>
              <MetricHelpLabel help={METRIC_HELP.effortConsumption} className="font-medium">
                EC
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {pct(summary.effortConsumption)}
            </dd>
          </div>
          <div>
            <dt>
              <MetricHelpLabel help={METRIC_HELP.inScopeWeeks} className="font-medium">
                In-scope weeks
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">{summary.inScopeWeekCount}</dd>
          </div>
        </dl>

        <dl className="grid grid-cols-3 gap-3 rounded-md border border-hairline bg-canvas px-3 py-2 text-caption">
          <div>
            <dt>
              <MetricHelpLabel help={METRIC_HELP.planned} className="font-medium">
                Planned
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">{hours(summary.plannedHours)} h</dd>
          </div>
          <div>
            <dt>
              <MetricHelpLabel help={METRIC_HELP.available} className="font-medium">
                Available
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {hours(summary.availableHours)} h
            </dd>
          </div>
          <div>
            <dt>
              <MetricHelpLabel help={METRIC_HELP.logged} className="font-medium">
                Logged
              </MetricHelpLabel>
            </dt>
            <dd className="font-semibold tabular-nums text-ink">{hours(summary.loggedHours)} h</dd>
          </div>
        </dl>

        {summary.detail ? (
          <p className="text-body-sm leading-relaxed text-ink">{summary.detail}</p>
        ) : null}

        {summary.excludedWeeks.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <MetricHelpLabel help={METRIC_HELP.excludedWeeks} className="text-caption font-medium">
              Excluded weeks
            </MetricHelpLabel>
            {summary.excludedWeeks.map((week) => (
              <span
                key={`${summary.memberId}-${week.weekId}`}
                className="rounded-md border border-hairline-strong bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-muted"
              >
                {week.weekId}
                <span className="text-ink-muted"> · {week.reason}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
