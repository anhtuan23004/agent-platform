import { useQuery } from '@tanstack/react-query';
import {
  type DemoAnalyticsResult,
  type DemoAnalyticsSettings,
  fetchDemoAnalytics,
} from '../api/demo-analytics.ts';

export const pmoDemoQueryKeys = {
  analytics: (settings?: DemoAnalyticsSettings) => ['pmo', 'demo-analytics', settings] as const,
};

export function useDemoAnalytics(settings?: DemoAnalyticsSettings) {
  return useQuery<DemoAnalyticsResult>({
    queryKey: pmoDemoQueryKeys.analytics(settings),
    queryFn: () => fetchDemoAnalytics(settings),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
