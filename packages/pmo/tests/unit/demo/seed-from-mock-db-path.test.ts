import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUNDLED_PMO02_MOCK_DB_RELATIVE,
  resolvePmoMockDbPath,
  resolvePmoSeedAssetRoot,
} from '../../../src/backend/demo/seed-from-mock-db.ts';

describe('resolvePmoMockDbPath', () => {
  const original = process.env.PMO_MOCK_DB_PATH;

  afterEach(() => {
    if (original === undefined) delete process.env.PMO_MOCK_DB_PATH;
    else process.env.PMO_MOCK_DB_PATH = original;
  });

  it('treats empty PMO_MOCK_DB_PATH as unset and falls back to bundled seed asset', () => {
    process.env.PMO_MOCK_DB_PATH = '';
    const path = resolvePmoMockDbPath();
    expect(path).toMatch(/pmo_02_mock-data\.db$/);
    expect(path).not.toBe('');
  });

  it('prefers explicit override over env', () => {
    process.env.PMO_MOCK_DB_PATH = '/env/path.db';
    expect(resolvePmoMockDbPath('/override/path.db')).toBe('/override/path.db');
  });

  it('bundled PMO_02 mock DB exists in hackathon/data', () => {
    const bundled = resolve(resolvePmoSeedAssetRoot(), BUNDLED_PMO02_MOCK_DB_RELATIVE);
    expect(existsSync(bundled)).toBe(true);
  });
});
