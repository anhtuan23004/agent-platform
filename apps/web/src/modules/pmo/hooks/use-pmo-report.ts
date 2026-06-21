import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreatePmoReportInput, pmoApi } from '../api/client';

export const pmoReportQueryKeys = {
  detail: (reportRunId: string) => ['pmo', 'reports', reportRunId] as const,
};

export function usePmoReport(reportRunId: string | null) {
  return useQuery({
    queryKey: pmoReportQueryKeys.detail(reportRunId ?? 'none'),
    queryFn: () => pmoApi.getReport(reportRunId as string),
    enabled: Boolean(reportRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return Math.min(1000 * 2 ** Math.min(query.state.dataUpdateCount, 3), 5000);
    },
    refetchOnWindowFocus: true,
  });
}

export function useCreatePmoReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePmoReportInput) => pmoApi.createReport(input),
    onSuccess: (report) => {
      queryClient.setQueryData(pmoReportQueryKeys.detail(report.reportRunId), report);
    },
  });
}

export function useRetryPmoReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reportRunId: string) => pmoApi.retryReport(reportRunId),
    onSuccess: (report) => {
      queryClient.setQueryData(pmoReportQueryKeys.detail(report.reportRunId), report);
    },
  });
}
