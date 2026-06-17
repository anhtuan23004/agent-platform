import type { SessionEnv } from '@seta/core';
import type { Hono } from 'hono';

import { DemoAnalyticsNoDataError, runDemoAnalytics } from '../analytics/demo-analytics.ts';

/** GET /api/pmo/v1/demo-analytics — calculation demo UI pipeline. */
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
}
