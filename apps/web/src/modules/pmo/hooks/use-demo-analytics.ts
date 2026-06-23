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

export function useDemoAnalytics(settings?: DemoAnalyticsSettings) {
  return useQuery<DemoAnalyticsResult>({
    queryKey: demoAnalyticsQueryKey(settings),
    queryFn: () => fetchDemoAnalytics(settings),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
