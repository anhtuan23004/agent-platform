import { type Statement, toManifest } from '@seta/shared-rbac';

export const pmoStatement = {
  'pmo.ingestion': ['upload', 'confirm', 'read'],
  'pmo.data': ['read'],
} as const satisfies Statement;

const roleStatements = {
  'pmo.viewer': { 'pmo.data': ['read'], 'pmo.ingestion': ['read'] },
  'pmo.operator': { 'pmo.ingestion': ['upload', 'confirm', 'read'], 'pmo.data': ['read'] },
} as const satisfies Record<string, Statement>;

export const pmoRbac = toManifest('pmo', pmoStatement, roleStatements, {
  'pmo.viewer': 'Read-only access to PMO data and ingestion status',
  'pmo.operator': 'Can upload files, confirm mappings, and read data',
});

export type PmoPermission = (typeof pmoRbac.permissions)[number]['key'];
