/**
 * Drawer adapter for the Report Configuration step.
 * Parses the approval payload to extract date range config and renders
 * an interactive date range form with confirm/skip buttons.
 */
import { Button, Input, Label } from '@seta/shared-ui';
import { useState } from 'react';
import { usePmoReportRangeActions } from '../../../../pmo/hooks/use-pmo-report-range-actions';
import type { WorkflowApprovalRow } from '../../api/schemas';

// ---------------------------------------------------------------------------
// Payload parser (same logic as readReportRangeConfigFromApproval in
// pmo-execution-step-card.tsx, which is not exported)
// ---------------------------------------------------------------------------

interface ReportSection {
  kind: 'workload' | 'forward_allocation';
  title: string;
  description: string;
  suggestedDateRange: { from: string; to: string };
}

interface ReportRangeConfig {
  bounds: { min: string; max: string } | null;
  source: 'database' | 'sheet_or_database';
  sections: ReportSection[];
}

function parseReportRangeConfig(approval: WorkflowApprovalRow): ReportRangeConfig | null {
  const payload = approval.proposedPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const primary = (payload as { primary?: unknown }).primary;
  if (!primary || typeof primary !== 'object' || Array.isArray(primary)) return null;
  const argsPatch = (primary as { argsPatch?: unknown }).argsPatch;
  if (!argsPatch || typeof argsPatch !== 'object' || Array.isArray(argsPatch)) return null;

  const rawBounds = (argsPatch as { databaseDateBounds?: unknown }).databaseDateBounds;
  const bounds =
    rawBounds && typeof rawBounds === 'object' && !Array.isArray(rawBounds)
      ? {
          min: String((rawBounds as { min?: unknown }).min ?? ''),
          max: String((rawBounds as { max?: unknown }).max ?? ''),
        }
      : null;

  const rawSource = (argsPatch as { rangeSource?: unknown }).rangeSource;
  const rawSections = (argsPatch as { reportSections?: unknown }).reportSections;
  const sections = Array.isArray(rawSections)
    ? (rawSections
        .map((section) => {
          if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
          const r = section as {
            kind?: unknown;
            title?: unknown;
            description?: unknown;
            suggestedDateRange?: unknown;
          };
          const sdr = r.suggestedDateRange;
          if (!sdr || typeof sdr !== 'object' || Array.isArray(sdr)) return null;
          const from = (sdr as { from?: unknown }).from;
          const to = (sdr as { to?: unknown }).to;
          if (
            (r.kind !== 'workload' && r.kind !== 'forward_allocation') ||
            typeof r.title !== 'string' ||
            typeof r.description !== 'string' ||
            typeof from !== 'string' ||
            typeof to !== 'string'
          )
            return null;
          return {
            kind: r.kind,
            title: r.title,
            description: r.description,
            suggestedDateRange: { from, to },
          };
        })
        .filter(Boolean) as ReportSection[])
    : [];

  return {
    bounds: bounds?.min && bounds.max ? bounds : null,
    source: rawSource === 'sheet_or_database' ? 'sheet_or_database' : 'database',
    sections,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DrawerReport({
  approval,
  onDecisionComplete,
}: {
  approval: WorkflowApprovalRow;
  onDecisionComplete: () => Promise<void> | void;
}) {
  const config = parseReportRangeConfig(approval);
  const { isSubmittingReportDecision, confirmReportRange, rejectReportRange } =
    usePmoReportRangeActions({
      selectedReportApproval: approval,
      onDecisionComplete,
    });

  if (!config) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
        Could not parse report configuration from this approval.
      </div>
    );
  }

  return (
    <ReportRangeForm
      config={config}
      isSubmitting={isSubmittingReportDecision}
      onConfirm={confirmReportRange}
      onSkip={rejectReportRange}
    />
  );
}

// ---------------------------------------------------------------------------
// Date range form (mirrors PmoReportRangeForm from pmo-execution-step-card)
// ---------------------------------------------------------------------------

function ReportRangeForm({
  config,
  isSubmitting,
  onConfirm,
  onSkip,
}: {
  config: ReportRangeConfig;
  isSubmitting: boolean;
  onConfirm: (
    ranges: {
      workloadDateRange?: { from: string; to: string };
      forwardAllocationDateRange?: { from: string; to: string };
    },
    strategy?: 'sheet_derived' | 'manual_database',
  ) => void;
  onSkip: () => void;
}) {
  const workloadSection = config.sections.find((s) => s.kind === 'workload');
  const forwardSection = config.sections.find((s) => s.kind === 'forward_allocation');
  const [workloadFrom, setWorkloadFrom] = useState(workloadSection?.suggestedDateRange.from ?? '');
  const [workloadTo, setWorkloadTo] = useState(workloadSection?.suggestedDateRange.to ?? '');
  const [forwardFrom, setForwardFrom] = useState(forwardSection?.suggestedDateRange.from ?? '');
  const [forwardTo, setForwardTo] = useState(forwardSection?.suggestedDateRange.to ?? '');
  const min = config.bounds?.min;
  const max = config.bounds?.max;

  const workloadValid =
    !workloadSection ||
    Boolean(
      workloadFrom &&
        workloadTo &&
        workloadFrom <= workloadTo &&
        (!min || workloadFrom >= min) &&
        (!max || workloadTo <= max),
    );
  const forwardValid =
    !forwardSection ||
    Boolean(forwardFrom && forwardTo && forwardFrom <= forwardTo && (!min || forwardFrom >= min));
  const canSubmit = workloadValid && forwardValid;

  return (
    <div className="space-y-3">
      {config.sections.map((section) => (
        <div
          key={section.kind}
          className="rounded-md border border-hairline bg-surface-1 px-3 py-2"
        >
          <p className="font-medium text-ink">{section.title}</p>
          <p className="text-body-sm text-ink-subtle">{section.description}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`drawer-${section.kind}-from`}>From</Label>
              <Input
                id={`drawer-${section.kind}-from`}
                type="date"
                min={min}
                max={section.kind === 'workload' ? max : undefined}
                value={section.kind === 'workload' ? workloadFrom : forwardFrom}
                onChange={(e) =>
                  section.kind === 'workload'
                    ? setWorkloadFrom(e.target.value)
                    : setForwardFrom(e.target.value)
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`drawer-${section.kind}-to`}>To</Label>
              <Input
                id={`drawer-${section.kind}-to`}
                type="date"
                min={min}
                max={section.kind === 'workload' ? max : undefined}
                value={section.kind === 'workload' ? workloadTo : forwardTo}
                onChange={(e) =>
                  section.kind === 'workload'
                    ? setWorkloadTo(e.target.value)
                    : setForwardTo(e.target.value)
                }
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex justify-end gap-2 border-t border-hairline pt-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onSkip}
          disabled={isSubmitting}
        >
          Skip report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={!canSubmit || isSubmitting}
          onClick={() =>
            onConfirm(
              {
                ...(workloadSection
                  ? { workloadDateRange: { from: workloadFrom, to: workloadTo } }
                  : {}),
                ...(forwardSection
                  ? { forwardAllocationDateRange: { from: forwardFrom, to: forwardTo } }
                  : {}),
              },
              'manual_database',
            )
          }
        >
          {isSubmitting ? 'Generating...' : 'Generate report'}
        </Button>
      </div>
    </div>
  );
}
