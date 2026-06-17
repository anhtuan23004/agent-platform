import { useQuery } from '@tanstack/react-query';
import { type DemoAnalyticsResult, fetchDemoAnalytics } from '../api/demo-analytics.ts';

export const pmoDemoQueryKeys = {
  analytics: ['pmo', 'demo-analytics'] as const,
};

export function useDemoAnalytics() {
  return useQuery<DemoAnalyticsResult>({
    queryKey: pmoDemoQueryKeys.analytics,
    queryFn: fetchDemoAnalytics,
  });
}
