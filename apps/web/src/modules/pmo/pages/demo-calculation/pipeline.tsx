import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@seta/shared-ui';
import type { ReactNode } from 'react';
import type { DemoAnalyticsResult } from '../../api/demo-analytics.ts';
import { analysisColumns, factColumns, memberColumns, projectMemberColumns } from './columns.tsx';
import { DemoCalculationFindingsPanel } from './findings-panel.tsx';

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-hairline shadow-sm">
      <CardHeader className="border-b border-hairline bg-surface-1 pb-4">
        <CardTitle className="text-body font-semibold">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-ink">
      {count}
    </span>
  );
}

function PipelineStageTab({
  value,
  label,
  count,
  hint,
}: {
  value: string;
  label: string;
  count: number;
  hint?: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="flex h-auto w-full flex-col items-start gap-1 rounded-lg border border-hairline bg-surface-1 px-4 py-3 text-left shadow-sm transition-colors hover:bg-surface-2 data-[state=active]:border-primary-border data-[state=active]:bg-canvas data-[state=active]:shadow-md border-b-0 -mb-0"
    >
      <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-2xl font-semibold tabular-nums text-ink">{count}</span>
        {hint ? <span className="text-caption font-medium text-ink-muted">{hint}</span> : null}
      </div>
    </TabsTrigger>
  );
}

interface DemoCalculationPipelineProps {
  data: DemoAnalyticsResult;
  getMemberLabel: (id: string) => string;
  getProjectLabel: (id: string) => string;
}

export function DemoCalculationPipeline({
  data,
  getMemberLabel,
  getProjectLabel,
}: DemoCalculationPipelineProps) {
  const findingCount = data.overbookIdleFindings.length + data.mismatchFindings.length;

  return (
    <section className="space-y-4">
      <Tabs defaultValue="findings">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-3 border-0 bg-transparent p-0 lg:grid-cols-4">
          <PipelineStageTab
            value="findings"
            label="Findings"
            count={findingCount}
            hint={`${data.overbookIdleFindings.length} overbook/idle · ${data.mismatchFindings.length} mismatch`}
          />
          <PipelineStageTab
            value="population"
            label="Populations"
            count={data.projectMemberDependencies.length}
            hint={`${data.populations.deliveryMembers.length} delivery · ${data.inputCounts.projects} projects`}
          />
          <PipelineStageTab
            value="facts"
            label="Member × week"
            count={data.memberWeekFacts.length}
            hint="persisted facts"
          />
          <PipelineStageTab
            value="analysis"
            label="Aggregation"
            count={data.memberAnalyses.length}
            hint="member rollups"
          />
        </TabsList>

        <TabsContent value="findings" className="mt-6">
          <DemoCalculationFindingsPanel
            overbookIdle={data.overbookIdleFindings}
            mismatch={data.mismatchFindings}
            getMemberLabel={getMemberLabel}
          />
        </TabsContent>

        <TabsContent value="population" className="mt-6">
          <SectionCard
            title="PM & delivery populations"
            description="Project managers are separated from delivery members before utilization is calculated."
          >
            <Tabs defaultValue="projectMembers" className="mt-1">
              <TabsList className="mb-4">
                <TabsTrigger value="projectMembers">
                  Project roster
                  <TabCount count={data.projectMemberDependencies.length} />
                </TabsTrigger>
                <TabsTrigger value="deliveryMembers">
                  Delivery
                  <TabCount count={data.populations.deliveryMembers.length} />
                </TabsTrigger>
                <TabsTrigger value="projectManagers">
                  PMs
                  <TabCount count={data.populations.projectManagers.length} />
                </TabsTrigger>
              </TabsList>
              <TabsContent value="projectMembers">
                <DataTable
                  data={data.projectMemberDependencies}
                  columns={projectMemberColumns(getMemberLabel, getProjectLabel)}
                />
              </TabsContent>
              <TabsContent value="deliveryMembers">
                <DataTable
                  data={data.populations.deliveryMembers}
                  columns={memberColumns(getMemberLabel)}
                />
              </TabsContent>
              <TabsContent value="projectManagers">
                <DataTable
                  data={data.populations.projectManagers}
                  columns={memberColumns(getMemberLabel)}
                />
              </TabsContent>
            </Tabs>
          </SectionCard>
        </TabsContent>

        <TabsContent value="facts" className="mt-6">
          <SectionCard
            title="Member × week facts"
            description="Persisted read-model: availability, planned and logged hours, busy rate, and effort consumption per week."
          >
            <DataTable data={data.memberWeekFacts} columns={factColumns(getMemberLabel)} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="analysis" className="mt-6">
          <SectionCard
            title="Member-level aggregation"
            description="Holiday, leave, approved OT, and training weeks are excluded before member-level ratios are computed."
          >
            <DataTable data={data.memberAnalyses} columns={analysisColumns(getMemberLabel)} />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </section>
  );
}
