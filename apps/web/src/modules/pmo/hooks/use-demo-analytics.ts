import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  type DemoAnalyticsResult,
  type DemoAnalyticsSettings,
  demoAnalyticsQueryKey,
  fetchDemoAnalytics,
} from '../api/demo-analytics.ts';

export const pmoDemoQueryKeys = {
  analytics: demoAnalyticsQueryKey,
};

/** Published analytics are computed at publish/seed; cache avoids repeat heavy reads. */
const DEMO_ANALYTICS_STALE_MS = 60_000;

export function useDemoAnalytics(settings?: DemoAnalyticsSettings) {
  return useQuery<DemoAnalyticsResult>({
    queryKey: demoAnalyticsQueryKey(settings),
    queryFn: () => fetchDemoAnalytics(settings),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: DEMO_ANALYTICS_STALE_MS,
  });
}
