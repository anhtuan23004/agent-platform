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

const PIPELINE_STEPS = [
  { id: 'findings', step: 1, label: 'Findings' },
  { id: 'population', step: 2, label: 'Populations' },
  { id: 'facts', step: 3, label: 'Facts' },
  { id: 'analysis', step: 4, label: 'Aggregation' },
] as const;

type PipelineTab = (typeof PIPELINE_STEPS)[number]['id'];

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
    <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-ink-muted">
      {count}
    </span>
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
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-subtle">
        <span className="font-medium uppercase tracking-wide">Pipeline</span>
        {PIPELINE_STEPS.map((item, index) => (
          <span key={item.id} className="inline-flex items-center gap-2">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary-tint text-[11px] font-semibold text-primary-ink">
              {item.step}
            </span>
            <span>{item.label}</span>
            {index < PIPELINE_STEPS.length - 1 ? (
              <span className="text-ink-subtle" aria-hidden>
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>

      <Tabs defaultValue={'findings' satisfies PipelineTab}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-lg border border-hairline bg-surface-1 p-1">
          <TabsTrigger
            value="findings"
            className="data-[state=active]:bg-canvas data-[state=active]:shadow-sm"
          >
            Findings
            <TabCount count={findingCount} />
          </TabsTrigger>
          <TabsTrigger
            value="population"
            className="data-[state=active]:bg-canvas data-[state=active]:shadow-sm"
          >
            Populations
            <TabCount count={data.projectMemberDependencies.length} />
          </TabsTrigger>
          <TabsTrigger
            value="facts"
            className="data-[state=active]:bg-canvas data-[state=active]:shadow-sm"
          >
            Member × week
            <TabCount count={data.memberWeekFacts.length} />
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className="data-[state=active]:bg-canvas data-[state=active]:shadow-sm"
          >
            Aggregation
            <TabCount count={data.memberAnalyses.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="mt-4">
          <DemoCalculationFindingsPanel
            overbookIdle={data.overbookIdleFindings}
            mismatch={data.mismatchFindings}
            getMemberLabel={getMemberLabel}
          />
        </TabsContent>

        <TabsContent value="population" className="mt-4">
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

        <TabsContent value="facts" className="mt-4">
          <SectionCard
            title="Member × week facts"
            description="Persisted read-model: availability, planned and logged hours, busy rate, and effort consumption per week."
          >
            <DataTable data={data.memberWeekFacts} columns={factColumns(getMemberLabel)} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="analysis" className="mt-4">
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
