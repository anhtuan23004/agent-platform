import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContributionRegistry } from '@seta/core';
import * as schema from './backend/db/schema.ts';
import { pmoWorkflows } from './backend/workflows/index.ts';
import { PMO_EVENTS } from './events.ts';
import { pmoRbac } from './rbac.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function registerPmoContributions(reg: ContributionRegistry): void {
  reg.module({
    name: 'pmo',
    schema,
    migrationsDir: resolve(__dirname, '../drizzle/migrations'),
    events: PMO_EVENTS,
    rbac: pmoRbac,
    workflows: pmoWorkflows,
  });
}
