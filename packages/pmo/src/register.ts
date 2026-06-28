import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContributionRegistry } from '@seta/core';
import { pmoAgentSpecs } from './backend/agent-specs.ts';
import { pmoAgentTools } from './backend/agent-tools/register.ts';
import * as schema from './backend/db/schema.ts';
import { buildPmoRoutes } from './backend/http/routes.ts';
import { pmoReportJobs } from './backend/reporting/jobs/index.ts';
import { loadPmoReportRuleCatalog } from './backend/reporting/rules/index.ts';
import { PMO_EVENTS } from './events.ts';
import { pmoRbac } from './rbac.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function registerPmoContributions(reg: ContributionRegistry): void {
  // Fail process boot before accepting traffic/jobs when versioned business rules are invalid.
  loadPmoReportRuleCatalog();
  reg.module({
    name: 'pmo',
    schema,
    migrationsDir: resolve(__dirname, '../drizzle/migrations'),
    events: PMO_EVENTS,
    rbac: pmoRbac,
    jobs: pmoReportJobs,
    agentTools: pmoAgentTools,
    agentSpecs: pmoAgentSpecs,
    routes: { mountAt: '/', build: buildPmoRoutes },
  });
}
