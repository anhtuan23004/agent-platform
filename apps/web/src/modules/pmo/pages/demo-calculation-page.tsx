import { Badge, EmptyState, PageChrome, PageChromeToolbar, Skeleton } from '@seta/shared-ui';
import { Database } from 'lucide-react';
import { useState } from 'react';
import type { DemoAnalyticsSettings } from '../api/demo-analytics.ts';
import { useDemoAnalytics } from '../hooks/use-demo-analytics.ts';
import { DemoCalculationFilters } from './demo-calculation/filters.tsx';
import { DemoCalculationPipeline } from './demo-calculation/pipeline.tsx';
import { useFilteredDemoAnalytics } from './demo-calculation/use-filtered-data.ts';

export function DemoCalculationPage() {
  const [analyticsSettings, setAnalyticsSettings] = useState<DemoAnalyticsSettings | undefined>();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useDemoAnalytics(analyticsSettings);
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const { filtered, members, projects, getMemberLabel, getProjectLabel } = useFilteredDemoAnalytics(
    data,
    memberFilter,
    projectFilter,
  );

  const noData = isError && error instanceof Error && error.message.includes('No PMO canonical');

  return (
    <PageChrome
      title="Utilization analytics"
      subtitle="Member-level overbook, idle, and mismatch findings from published PMO data."
    >
      <PageChromeToolbar
        left={
          <Badge variant={filtered ? 'default' : 'secondary'}>
            {isLoading ? 'Loading…' : filtered ? 'Published PMO data' : 'No data'}
          </Badge>
        }
      />

      {isLoading ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {noData ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No PMO data for this tenant"
          description="Publish PMO workbook data first, then refresh. For local dev: pnpm db:seed or insert-mock-to-tenant.ts."
        />
      ) : null}

      {isError && !noData ? (
        <p className="text-danger p-6 text-sm">
          {error instanceof Error ? error.message : 'Failed to load'}
        </p>
      ) : null}

      {filtered ? (
        <div className="space-y-6 bg-surface-1 p-6">
          <div className="rounded-lg border border-hairline bg-canvas px-4 py-3 shadow-sm">
            <DemoCalculationFilters
              members={members}
              projects={projects}
              memberFilter={memberFilter}
              projectFilter={projectFilter}
              onMemberFilterChange={setMemberFilter}
              onProjectFilterChange={setProjectFilter}
              getProjectLabel={getProjectLabel}
              reportingWindow={filtered.reportingWindow}
              thresholdConfig={filtered.thresholdConfig}
              thresholds={filtered.thresholds}
              analyticsSettings={analyticsSettings}
              onAnalyticsSettingsChange={setAnalyticsSettings}
              onRefresh={() => void refetch()}
              isRefreshing={isFetching}
            />
          </div>

          <DemoCalculationPipeline
            data={filtered}
            getMemberLabel={getMemberLabel}
            getProjectLabel={getProjectLabel}
          />
        </div>
      ) : null}
    </PageChrome>
  );
}
