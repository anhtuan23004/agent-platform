import type { DemoAnalyticsResult } from '../../api/demo-analytics.ts';
import { pct } from './formatters.tsx';

function MetricCard({
  label,
  value,
  hint,
  accentClass,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accentClass?: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas px-4 py-3 shadow-sm">
      <p className="text-caption font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums text-ink ${accentClass ?? ''}`}>
          {value}
        </span>
        {hint ? <span className="text-caption text-ink-subtle">{hint}</span> : null}
      </div>
    </div>
  );
}

function ThresholdPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-caption text-ink-subtle">
      <span>{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </span>
  );
}

export function DemoCalculationSummary({ data }: { data: DemoAnalyticsResult }) {
  const t = data.thresholds;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Overbook / idle"
          value={data.overbookIdleFindings.length}
          hint="members flagged"
          accentClass="text-warning-ink"
        />
        <MetricCard
          label="Mismatch"
          value={data.mismatchFindings.length}
          hint="logged vs plan"
          accentClass="text-danger-ink"
        />
        <MetricCard
          label="Member × week facts"
          value={data.memberWeekFacts.length}
          hint="persisted rows"
        />
        <MetricCard
          label="Delivery members"
          value={data.populations.deliveryMembers.length}
          hint={`${data.inputCounts.projects} projects`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
        <span className="text-caption font-medium uppercase tracking-wide text-ink-subtle">
          Reporting window
        </span>
        <span className="text-body-sm font-medium text-ink">
          {data.reportingWindow.start} → {data.reportingWindow.end}
        </span>
        <span className="hidden h-4 w-px bg-hairline sm:inline" />
        <span className="text-caption text-ink-subtle">Thresholds</span>
        <ThresholdPill label="Overbook Y" value={pct(t.overbookThreshold)} />
        <ThresholdPill label="Overbook R" value={pct(t.overbookRedThreshold)} />
        <ThresholdPill label="Idle" value={pct(t.idleThreshold)} />
        <ThresholdPill label="Mismatch" value={pct(t.mismatchPctThreshold)} />
      </div>
    </section>
  );
}
