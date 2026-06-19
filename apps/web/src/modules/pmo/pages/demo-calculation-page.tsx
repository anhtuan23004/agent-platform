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
import {
  buildSourceUploadOptions,
  formatDisplayDate,
  formatReportingPeriod,
  utilizationEmptyState,
} from './demo-calculation-page.logic.ts';

function uploadLabel(session: PmoPlanningSession): string {
  return `${session.workbook_name} · ${formatDisplayDate(session.uploaded_at)}`;
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
  const sessions = sessionsQuery.data?.items ?? [];
  const uploadOptions = buildSourceUploadOptions(sessions);

  const { filtered, members, projects, getMemberLabel, getProjectLabel } = useFilteredDemoAnalytics(
    data,
    memberFilter,
    projectFilter,
  );

  const noData = isError && error instanceof Error && error.message.includes('No PMO canonical');
  const emptyState = utilizationEmptyState({
    hasAnalyticsData: Boolean(filtered),
    hasNoDataError: noData && !sessionsQuery.isLoading,
    hasActiveDataFilters: Boolean(
      analyticsSettings?.from || analyticsSettings?.to || analyticsSettings?.ingestionSessionId,
    ),
    sessions,
  });
  const resetDataFilters = () => {
    setAnalyticsSettings(undefined);
    setMemberFilter(null);
    setProjectFilter(null);
  };
  const openUploadFlow = () => {
    window.location.assign('/pmo');
  };

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

      {emptyState === 'no_uploads' ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No utilization data yet"
          description="Upload and publish a PMO workbook before viewing utilization analytics."
          action={{ label: 'Upload workbook', onClick: openUploadFlow }}
        />
      ) : null}

      {emptyState === 'unpublished_uploads' ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No published utilization data"
          description="A workbook exists, but utilization analytics only uses published PMO canonical data."
          action={{ label: 'Continue ingestion', onClick: openUploadFlow }}
        />
      ) : null}

      {emptyState === 'filter_empty' ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No utilization data for this selection"
          description="Try a broader reporting window or a different source upload."
          action={{ label: 'Reset date and source filters', onClick: resetDataFilters }}
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
              uploadOptions={uploadOptions}
              selectedUploadId={analyticsSettings?.ingestionSessionId ?? null}
              selectedUploadLabel={
                selectedUpload
                  ? `${uploadLabel(selectedUpload)} · ${formatReportingPeriod(selectedUpload)}`
                  : null
              }
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
