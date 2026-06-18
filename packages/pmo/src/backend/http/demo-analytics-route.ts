import type { SessionEnv } from '@seta/core';
import type { Hono } from 'hono';
import { z } from 'zod';

import { DemoAnalyticsNoDataError, runDemoAnalytics } from '../analytics/demo-analytics.ts';
import { ensureFactsComputed } from '../analytics/ensure-facts-computed.ts';

const ComputeFactsRequestSchema = z.object({
  ingestion_session_id: z.string().uuid().optional(),
});

/** PMO utilization analytics HTTP routes (calculation demo UI). */
export function registerDemoAnalyticsRoutes(app: Hono<SessionEnv>): void {
  app.get('/api/pmo/v1/demo-analytics', async (c) => {
    const session = c.get('user');
    try {
      const result = await runDemoAnalytics(session.tenant_id);
      return c.json(result);
    } catch (err: unknown) {
      if (err instanceof DemoAnalyticsNoDataError) {
        return c.json({ error: 'no_data', message: err.message }, 404);
      }
      throw err;
    }
  });

  app.post('/api/pmo/v1/analytics/compute-facts', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = ComputeFactsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    try {
      const result = await ensureFactsComputed(session.tenant_id, {
        sessionId: parsed.data.ingestion_session_id,
        force: true,
      });
      return c.json({
        factCount: result.factCount,
        memberCount: result.memberCount,
        weekIds: result.weekIds,
        computedAt: result.computedAt.toISOString(),
        ingestionSessionId: result.ingestionSessionId,
        recomputed: result.recomputed,
      });
    } catch (err: unknown) {
      if (err instanceof DemoAnalyticsNoDataError) {
        return c.json({ error: 'no_data', message: err.message }, 404);
      }
      throw err;
    }
  });
}
