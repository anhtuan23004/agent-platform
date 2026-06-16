import {
  Badge,
  Button,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@seta/shared-ui';
import { Check, ChevronRight, Copy, FileJson } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WorkflowRunRow } from '../api/schemas.ts';

interface SnapshotShape {
  status?: string;
  context?: Record<string, unknown>;
}

export interface RunRightPanelProps {
  run: WorkflowRunRow;
  streamEvents: unknown[];
  snapshot?: unknown;
  plannerSteps?: Array<{ step_no: number; step_name: string; description?: string }>;
  plannerStepsLoading?: boolean;
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'object' && v !== null && Object.keys(v as object).length === 0) return true;
  return false;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard permission denials.
    }
  };
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label="Copy to clipboard">
      {copied ? (
        <>
          <Check className="size-3" aria-hidden /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3" aria-hidden /> Copy
        </>
      )}
    </Button>
  );
}

interface JsonBlockProps {
  value: unknown;
  emptyTitle: string;
  emptyDescription: string;
}

function JsonBlock({ value, emptyTitle, emptyDescription }: JsonBlockProps) {
  const isEmpty = isEmptyValue(value);
  const pretty = useMemo(() => {
    if (isEmpty) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value, isEmpty]);

  if (isEmpty) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<FileJson className="size-5" />}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    );
  }

  const lineCount = pretty.split('\n').length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 flex-none items-center justify-between border-b border-hairline px-3 text-[11px] uppercase tracking-wider text-ink-subtle">
        <span>{lineCount} lines</span>
        <CopyButton text={pretty} />
      </div>
      <pre className="m-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-surface-1 p-3 font-mono text-[11.5px] leading-[1.55] text-ink">
        {pretty}
      </pre>
    </div>
  );
}

interface StepContextEntry {
  status?: string;
  payload?: unknown;
  output?: unknown;
  error?: unknown;
}

type PlannerStepStatus =
  | 'pending'
  | 'in_progress'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

function plannerStepMatchesRuntimeStep(
  plannerStep: { step_no: number; step_name: string },
  runtimeStepId: string,
): boolean {
  const runtime = runtimeStepId.toLowerCase();
  const stepName = plannerStep.step_name.toLowerCase();

  if (runtime.includes('confirmmapping')) {
    if (plannerStep.step_no === 2) return true;
    return /mapping|confirm/.test(stepName);
  }

  if (runtime.includes('normalize')) {
    if (plannerStep.step_no === 3) return true;
    return /normalize|staging|diff/.test(stepName);
  }

  if (runtime.includes('reviewchanges')) {
    if (plannerStep.step_no === 4) return true;
    return /review|readiness|impact|database|publish/.test(stepName);
  }

  if (runtime.includes('detect')) {
    if (plannerStep.step_no === 1) return true;
    return /profil|schema|detect/.test(stepName);
  }

  const runtimeTail = runtime.replace(/^.*\./, '');
  return runtimeTail.length > 0 ? stepName.includes(runtimeTail) : false;
}

function plannerStatusFromRuntimeStatuses(statuses: string[]): PlannerStepStatus {
  const normalized = statuses.map((status) => status.toLowerCase());

  if (normalized.some((status) => status === 'failed' || status === 'error')) {
    return 'failed';
  }

  if (normalized.some((status) => status === 'success' || status === 'completed')) {
    return 'completed';
  }

  if (
    normalized.some(
      (status) => status === 'needs_review' || status === 'paused' || status === 'suspended',
    )
  ) {
    return 'needs_review';
  }

  if (normalized.some((status) => status === 'running' || status === 'in_progress')) {
    return 'in_progress';
  }

  return 'pending';
}

function plannerStatusTone(
  status: PlannerStepStatus,
): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'destructive';
  if (status === 'in_progress' || status === 'needs_review') return 'warning';
  return 'secondary';
}

function plannerStatusLabel(status: PlannerStepStatus): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'needs_review') return 'Needs review';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Pending';
}

function stepStatusTone(
  status: string | undefined,
): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (!status || status === 'pending') return 'secondary';
  if (status === 'success') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'suspended' || status === 'paused') return 'warning';
  return 'secondary';
}

interface StepRowProps {
  stepId: string;
  entry: StepContextEntry;
}

function StepRow({ stepId, entry }: StepRowProps) {
  const [open, setOpen] = useState(false);
  const statusLabel = entry.status ?? 'pending';
  const tone = stepStatusTone(entry.status);
  const hasOutput = !isEmptyValue(entry.output);
  const hasError = !isEmptyValue(entry.error);
  const hasPayload = !isEmptyValue(entry.payload);
  const hasData = hasOutput || hasError || hasPayload;

  const dataLabel = hasError ? 'Error' : hasOutput ? 'Output' : hasPayload ? 'Input' : null;
  const dataValue = hasError ? entry.error : hasOutput ? entry.output : entry.payload;

  const prettyData = useMemo(() => {
    if (!dataValue) return '';
    try {
      return JSON.stringify(dataValue, null, 2);
    } catch {
      return String(dataValue);
    }
  }, [dataValue]);

  return (
    <li className="border-b border-hairline-tertiary last:border-b-0">
      <button
        type="button"
        onClick={() => hasData && setOpen((v) => !v)}
        disabled={!hasData}
        aria-expanded={hasData ? open : undefined}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-1 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ChevronRight
          aria-hidden
          className={`size-3 flex-none text-ink-tertiary transition-transform ${
            open ? 'rotate-90' : ''
          } ${hasData ? '' : 'invisible'}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">{stepId}</span>
        <Badge variant={tone} className="flex-none text-[10px]">
          {statusLabel}
        </Badge>
        {dataLabel && <span className="flex-none text-[10px] text-ink-tertiary">{dataLabel}</span>}
      </button>
      {open && hasData ? (
        <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-hairline-tertiary bg-surface-1 px-3 py-2 font-mono text-[11px] leading-[1.5] text-ink">
          {prettyData}
        </pre>
      ) : null}
    </li>
  );
}

interface CurrentRunTabProps {
  run: WorkflowRunRow;
  snapshot: SnapshotShape | null;
  plannerSteps: Array<{ step_no: number; step_name: string; description?: string }>;
  plannerStepsLoading: boolean;
}

function CurrentRunTab({ run, snapshot, plannerSteps, plannerStepsLoading }: CurrentRunTabProps) {
  const workflowInput = snapshot?.context?.input ?? run.inputSummary ?? null;

  const snapshotContext = snapshot?.context;
  const contextEntries = useMemo(
    () =>
      Object.entries(snapshotContext ?? {}).filter(([key]) => key !== 'input' && key !== '__state'),
    [snapshotContext],
  );

  const plannerRows = useMemo(() => {
    if (plannerSteps.length === 0) return [];

    return plannerSteps.map((plannerStep) => {
      const matchedStatuses = contextEntries
        .filter(([stepId]) => plannerStepMatchesRuntimeStep(plannerStep, stepId))
        .map(([, entry]) => {
          const status = (entry as StepContextEntry).status;
          return typeof status === 'string' ? status : 'pending';
        });

      let status = plannerStatusFromRuntimeStatuses(matchedStatuses);

      if (run.status === 'canceled' && status !== 'completed' && status !== 'failed') {
        status = 'cancelled';
      }

      return {
        ...plannerStep,
        status,
      };
    });
  }, [contextEntries, plannerSteps, run.status]);

  const steps = useMemo<[string, StepContextEntry][]>(() => {
    return contextEntries.map(([key, val]) => [key, (val ?? {}) as StepContextEntry]);
  }, [contextEntries]);

  const [inputOpen, setInputOpen] = useState(true);

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Input section */}
      <section className="flex-none border-b border-hairline">
        <button
          type="button"
          onClick={() => setInputOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-1"
        >
          <ChevronRight
            aria-hidden
            className={`size-3 flex-none text-ink-tertiary transition-transform ${inputOpen ? 'rotate-90' : ''}`}
          />
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
            Input
          </span>
        </button>
        {inputOpen && (
          <div className="max-h-48 overflow-auto border-t border-hairline-tertiary">
            {isEmptyValue(workflowInput) ? (
              <p className="px-4 py-3 text-xs text-ink-subtle">No input payload.</p>
            ) : (
              <pre className="m-0 whitespace-pre-wrap break-all bg-surface-1 px-3 py-2 font-mono text-[11px] leading-[1.5] text-ink">
                {(() => {
                  try {
                    return JSON.stringify(workflowInput, null, 2);
                  } catch {
                    return String(workflowInput);
                  }
                })()}
              </pre>
            )}
          </div>
        )}
      </section>

      {/* Planner-defined business steps section */}
      <section className="flex-none border-b border-hairline">
        <div className="flex h-9 items-center px-3 text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
          Planner steps
        </div>
        {plannerStepsLoading ? (
          <p className="px-4 pb-3 text-xs text-ink-subtle">Loading planner steps…</p>
        ) : plannerRows.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-ink-subtle">
            No planner steps attached to this run.
          </p>
        ) : (
          <ol className="space-y-1 px-3 pb-3">
            {plannerRows.map((step) => (
              <li
                key={`planner-step-${step.step_no}`}
                className="rounded-md border border-hairline-tertiary bg-surface-1 px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-ink">
                    {step.step_no}. {step.step_name}
                  </p>
                  <Badge variant={plannerStatusTone(step.status)} className="text-[10px]">
                    {plannerStatusLabel(step.status)}
                  </Badge>
                </div>
                {step.description ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-ink-subtle">
                    {step.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Steps section */}
      <section className="flex-1">
        <div className="flex h-9 items-center px-3 text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
          Steps{steps.length > 0 ? ` (${steps.length})` : ''}
        </div>
        {steps.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState
              icon={<FileJson className="size-5" />}
              title="No steps yet"
              description="Steps will appear here as the run progresses."
            />
          </div>
        ) : (
          <ul>
            {steps.map(([stepId, entry]) => (
              <StepRow key={stepId} stepId={stepId} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function RunRightPanel({
  run,
  snapshot,
  plannerSteps = [],
  plannerStepsLoading = false,
}: RunRightPanelProps) {
  const snap = (snapshot ?? null) as SnapshotShape | null;
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-hairline bg-canvas">
      <Tabs defaultValue="current-run" className="flex h-full min-h-0 flex-col">
        <TabsList className="h-11 flex-none gap-0 px-3">
          <TabsTrigger value="current-run" className="px-3 py-2 text-xs">
            Current Run
          </TabsTrigger>
          <TabsTrigger value="state" className="px-3 py-2 text-xs">
            State
          </TabsTrigger>
        </TabsList>
        <TabsContent value="current-run" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <CurrentRunTab
            run={run}
            snapshot={snap}
            plannerSteps={plannerSteps}
            plannerStepsLoading={plannerStepsLoading}
          />
        </TabsContent>
        <TabsContent value="state" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <JsonBlock
            value={snap?.context ?? null}
            emptyTitle="No state yet"
            emptyDescription="The workflow hasn't written any context values yet."
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
