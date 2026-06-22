import { Badge, Button, ChatToolCall, toast } from '@seta/shared-ui';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { ReportStatusCard } from '../../../pmo/components/pmo-report-panel';
import {
  useCreatePmoReport,
  usePmoReport,
  useRetryPmoReport,
} from '../../../pmo/hooks/use-pmo-report';

interface PmoGenerateReportRendererProps {
  name: string;
  state: 'input-streaming' | 'output-available' | 'output-error';
  output?: {
    reportRunId?: string;
    dateRange?: { from: string; to: string };
    summary?: { memberCount?: number; overbookCount?: number; idleCount?: number };
    members?: PmoRecommendationMember[];
    recommendations?: PmoRecommendationGroup[];
    dataQuality?: { recommendationDegraded: boolean; flags: string[] };
    projectionFreshness?: PmoProjectionFreshness;
  };
}

interface PmoRecommendRebalanceRendererProps {
  name: string;
  state: 'input-streaming' | 'output-available' | 'output-error';
  output?: {
    dateRange?: { from: string; to: string };
    members?: PmoRecommendationMember[];
    recommendations?: PmoRecommendationGroup[];
    dataQuality?: { recommendationDegraded: boolean; flags: string[] };
    projectionFreshness?: PmoProjectionFreshness;
  };
}

interface PmoRecommendationMember {
  memberId: string;
  fullName: string;
}

interface PmoProjectionFreshness {
  skillsCount: number;
  taskHistoryCount: number;
  lastSyncedAt: string | null;
  degraded: boolean;
}

interface PmoRecommendationGroup {
  sourceMemberId: string;
  weekId: string;
  severity: 'yellow' | 'red';
  requiredReductionHours: number;
  status: 'full_solution' | 'partial_relief' | 'no_valid_rebalance_found';
  recommendations: Array<{
    targetMemberId: string;
    projectId: string;
    transferHours: number;
    score: number;
    confidence: 'high' | 'medium' | 'low';
    rankWithinSource: number;
    portfolioSelected: boolean;
    mutuallyExclusiveAlternative: boolean;
    beforeAfter: {
      sourceBeforeBusyRate: number;
      sourceAfterBusyRate: number;
      targetBeforeBusyRate: number;
      targetAfterBusyRate: number;
    };
    evidence: {
      matchedSkills: string[];
      missingSkills: string[];
      similarPastTasks: string[];
    };
    recommendationDegraded: boolean;
    dataQualityFlags: string[];
  }>;
  noResultReasons: string[];
  recommendationDegraded: boolean;
  dataQualityFlags: string[];
}

export function PmoGenerateReportRenderer(props: PmoGenerateReportRendererProps) {
  const sourceReportRunId = props.output?.reportRunId ?? null;
  const [pdfReportRunId, setPdfReportRunId] = useState<string | null>(null);
  const report = usePmoReport(pdfReportRunId ?? sourceReportRunId);
  const create = useCreatePmoReport();
  const retry = useRetryPmoReport();

  if (props.state === 'output-error') {
    return <ChatToolCall name={props.name} status="error" summary="failed" />;
  }
  if (props.state !== 'output-available') {
    return <ChatToolCall name={props.name} status="running" summary="Generating report" />;
  }
  if (report.data) {
    if (
      report.data.status === 'completed' &&
      !report.data.artifacts.pdf.available &&
      !pdfReportRunId &&
      props.output?.dateRange
    ) {
      const dateRange = props.output.dateRange;
      return (
        <div className="space-y-2">
          <ChatToolCall
            name={props.name}
            status="ok"
            summary={`${props.output.summary?.overbookCount ?? 0} overbook · ${props.output.summary?.idleCount ?? 0} idle`}
            payload={props.output}
          />
          <PmoRecommendationGroups
            groups={props.output.recommendations ?? []}
            members={props.output.members ?? []}
            dataQuality={props.output.dataQuality}
            projectionFreshness={props.output.projectionFreshness}
            collapsed
          />
          <Button
            size="sm"
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                {
                  dateRange,
                  reportTypes: ['overbook', 'idle'],
                  recommendationCandidateCount: 3,
                },
                {
                  onSuccess: (next) => setPdfReportRunId(next.reportRunId),
                  onError: (error) =>
                    toast.error('PDF request failed', { description: error.message }),
                },
              )
            }
          >
            <FileDown /> Generate PDF
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <PmoRecommendationGroups
          groups={props.output?.recommendations ?? []}
          members={props.output?.members ?? []}
          dataQuality={props.output?.dataQuality}
          projectionFreshness={props.output?.projectionFreshness}
          collapsed
        />
        <ReportStatusCard
          report={report.data}
          isRetrying={retry.isPending}
          onRetry={() => retry.mutate(report.data.reportRunId)}
        />
      </div>
    );
  }
  const summary = props.output?.summary;
  return (
    <div className="space-y-2">
      <ChatToolCall
        name={props.name}
        status="ok"
        summary={
          summary
            ? `${summary.overbookCount ?? 0} overbook · ${summary.idleCount ?? 0} idle`
            : (sourceReportRunId ?? 'completed')
        }
        payload={props.output}
      />
      <PmoRecommendationGroups
        groups={props.output?.recommendations ?? []}
        members={props.output?.members ?? []}
        dataQuality={props.output?.dataQuality}
        projectionFreshness={props.output?.projectionFreshness}
        collapsed
      />
    </div>
  );
}

export function PmoRecommendRebalanceRenderer(props: PmoRecommendRebalanceRendererProps) {
  if (props.state === 'output-error') {
    return <ChatToolCall name={props.name} status="error" summary="failed" />;
  }
  if (props.state !== 'output-available') {
    return <ChatToolCall name={props.name} status="running" summary="Finding candidates" />;
  }
  return (
    <div className="space-y-2">
      <ChatToolCall
        name={props.name}
        status="ok"
        summary={`${props.output?.recommendations?.length ?? 0} rebalance group(s)`}
        payload={props.output}
      />
      <PmoRecommendationGroups
        groups={props.output?.recommendations ?? []}
        members={props.output?.members ?? []}
        dataQuality={props.output?.dataQuality}
        projectionFreshness={props.output?.projectionFreshness}
        showEmptyState
      />
    </div>
  );
}

function PmoRecommendationGroups(props: {
  groups: PmoRecommendationGroup[];
  members: PmoRecommendationMember[];
  dataQuality?: { recommendationDegraded: boolean; flags: string[] };
  projectionFreshness?: PmoProjectionFreshness;
  collapsed?: boolean;
  showEmptyState?: boolean;
}) {
  if (
    props.groups.length === 0 &&
    !props.dataQuality?.recommendationDegraded &&
    !props.showEmptyState
  ) {
    return null;
  }
  const memberName = new Map(props.members.map((member) => [member.memberId, member.fullName]));
  const emptyReasons = props.dataQuality?.flags?.length
    ? props.dataQuality.flags.map(humanize).join(', ')
    : 'No candidate passed hard filters';
  const content = (
    <div className="space-y-2">
      {props.projectionFreshness?.degraded ? (
        <p className="rounded-md border border-warning-border bg-warning-tint px-2 py-1.5 text-caption text-warning-ink">
          Candidate evidence degraded · skills {props.projectionFreshness.skillsCount} · history{' '}
          {props.projectionFreshness.taskHistoryCount}
        </p>
      ) : null}
      {props.groups.map((group) => (
        <section key={`${group.sourceMemberId}:${group.weekId}`} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-body-sm text-ink">
              {memberName.get(group.sourceMemberId) ?? group.sourceMemberId}
            </strong>
            <Badge variant={group.severity === 'red' ? 'destructive' : 'warning'}>
              {group.severity}
            </Badge>
            <Badge variant="secondary">{group.weekId}</Badge>
            <Badge variant={group.status === 'full_solution' ? 'success' : 'secondary'}>
              {humanize(group.status)}
            </Badge>
            <span className="font-mono text-caption text-ink-subtle">
              {formatHours(group.requiredReductionHours)}h reduction
            </span>
          </div>
          {group.recommendationDegraded ? (
            <p className="text-caption text-warning-ink">
              Evidence degraded: {group.dataQualityFlags.map(humanize).join(', ')}
            </p>
          ) : null}
          {group.status === 'no_valid_rebalance_found' ? (
            <p className="text-body-sm text-ink-subtle">
              No valid rebalance found: {group.noResultReasons.map(humanize).join(', ')}
            </p>
          ) : (
            <div className="grid gap-2">
              {group.recommendations.map((candidate) => (
                <article
                  key={`${candidate.targetMemberId}:${candidate.projectId}:${candidate.rankWithinSource}`}
                  className="rounded-lg border border-hairline bg-surface-1 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-body-sm text-ink">
                        #{candidate.rankWithinSource}{' '}
                        {memberName.get(candidate.targetMemberId) ?? candidate.targetMemberId}
                      </strong>
                      <span className="text-caption text-ink-subtle">
                        {candidate.projectId} · {candidate.confidence} confidence
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary">score {formatScore(candidate.score)}</Badge>
                      {candidate.portfolioSelected ? (
                        <Badge variant="success">portfolio selected</Badge>
                      ) : null}
                      {candidate.mutuallyExclusiveAlternative ? (
                        <Badge variant="outline">alternative</Badge>
                      ) : null}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-caption">
                    <Metric label="Transfer" value={`${formatHours(candidate.transferHours)}h`} />
                    <Metric
                      label="Source"
                      value={`${pct(candidate.beforeAfter.sourceBeforeBusyRate)} -> ${pct(
                        candidate.beforeAfter.sourceAfterBusyRate,
                      )}`}
                    />
                    <Metric
                      label="Target"
                      value={`${pct(candidate.beforeAfter.targetBeforeBusyRate)} -> ${pct(
                        candidate.beforeAfter.targetAfterBusyRate,
                      )}`}
                    />
                  </dl>
                  <p className="mt-2 text-caption text-ink-subtle">
                    Matched: {candidate.evidence.matchedSkills.join(', ') || 'none'}
                  </p>
                  <p className="text-caption text-ink-subtle">
                    Similar: {candidate.evidence.similarPastTasks.join(', ') || 'unavailable'}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
      {props.groups.length === 0 ? (
        <p className="text-body-sm text-ink-subtle">No valid rebalance found: {emptyReasons}</p>
      ) : null}
    </div>
  );
  if (!props.collapsed) {
    return <div className="rounded-lg border border-hairline bg-canvas p-3">{content}</div>;
  }
  return (
    <details className="rounded-lg border border-hairline bg-canvas p-3">
      <summary className="cursor-pointer text-body-sm font-semibold text-ink">
        Recommendations ({props.groups.length})
      </summary>
      <div className="mt-2">{content}</div>
    </details>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-canvas px-2 py-1.5">
      <dt className="uppercase text-ink-subtle">{props.label}</dt>
      <dd className="font-mono text-ink">{props.value}</dd>
    </div>
  );
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}
