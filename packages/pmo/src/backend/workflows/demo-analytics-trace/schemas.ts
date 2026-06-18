import { z } from 'zod';

/**
 * PMO demo analytics trace workflow:
 * no input — tenant context comes from authenticated requestContext.
 */
export const DemoAnalyticsTraceInputSchema = z.object({});

// Keep schemas permissive to avoid over-coupling UI snapshots to internal shapes.
export const CanonicalSnapshotSchema = z.object({
  members: z.array(z.unknown()),
  allocations: z.array(z.unknown()),
  timesheets: z.array(z.unknown()),
  leaves: z.array(z.unknown()),
  weeks: z.array(z.unknown()),
  configRows: z.array(z.unknown()),
});

export const FactsSnapshotSchema = z.object({
  memberWeekFacts: z.array(z.unknown()),
});

export const AnalysesSnapshotSchema = z.object({
  memberAnalyses: z.array(z.unknown()),
});

export const FindingsSnapshotSchema = z.object({
  overbookIdleFindings: z.array(z.unknown()),
  mismatchFindings: z.array(z.unknown()),
});

export const DemoAnalyticsTraceOutputSchema = z.object({
  result: z.unknown(),
});
