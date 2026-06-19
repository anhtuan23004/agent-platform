import { Badge, EmptyState, PageChrome, PageChromeToolbar, Skeleton } from '@seta/shared-ui';
import { useQuery } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { useState } from 'react';
import { type PmoPlanningSession, pmoApi } from '../api/client.ts';
import type { DemoAnalyticsSettings } from '../api/demo-analytics.ts';
import { useDemoAnalytics } from '../hooks/use-demo-analytics.ts';
import { DemoCalculationFilters } from './demo-calculation/filters.tsx';
import { DemoCalculationPipeline } from './demo-calculation/pipeline.tsx';
import { useFilteredDemoAnalytics } from './demo-calculation/use-filtered-data.ts';

function uploadLabel(session: PmoPlanningSession): string {
  const date = new Date(session.uploaded_at);
  const uploadedAt = Number.isNaN(date.getTime())
    ? session.uploaded_at
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${session.workbook_name} · ${uploadedAt}`;
}

export function DemoCalculationPage() {
  const [analyticsSettings, setAnalyticsSettings] = useState<DemoAnalyticsSettings | undefined>();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useDemoAnalytics(analyticsSettings);
  const sessionsQuery = useQuery({
    queryKey: ['pmo', 'ingestion-sessions', 'utilization-filter'],
    queryFn: () => pmoApi.listPlanningSessions(),
  });
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const selectedUpload = analyticsSettings?.ingestionSessionId
    ? (sessionsQuery.data?.items.find(
        (item) => item.ingestion_session_id === analyticsSettings.ingestionSessionId,
      ) ?? null)
    : null;

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
              uploadOptions={(sessionsQuery.data?.items ?? []).map((session) => ({
                id: session.ingestion_session_id,
                label: uploadLabel(session),
                statusLabel: session.status_label,
              }))}
              selectedUploadId={analyticsSettings?.ingestionSessionId ?? null}
              selectedUploadLabel={selectedUpload ? uploadLabel(selectedUpload) : null}
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
