import * as fs from 'node:fs';
import * as path from 'node:path';
import { type PmoReportRuleSet, validateRuleSet } from './schema.ts';

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
}

function hasJsonFiles(directory: string): boolean {
  return (
    fs.existsSync(directory) &&
    fs.statSync(directory).isDirectory() &&
    fs.readdirSync(directory).some((name) => name.endsWith('.json'))
  );
}

export function resolvePmoReportRuleCatalogDir(explicitDirectory?: string): string {
  const configuredDir = explicitDirectory ?? process.env.PMO_REPORT_RULES_DIR?.trim();
  const repoRoot = findRepoRoot(process.cwd());
  const appHome = process.env.APP_HOME?.trim();
  const candidates = uniquePaths(
    [
      configuredDir,
      path.join(repoRoot, 'config', 'pmo-report-rules'),
      appHome ? path.join(appHome, 'config', 'pmo-report-rules') : null,
      path.resolve(process.cwd(), '..', '..', 'config', 'pmo-report-rules'),
    ].filter((value): value is string => Boolean(value)),
  );

  for (const candidate of candidates) {
    if (hasJsonFiles(candidate)) return candidate;
  }

  throw new Error(
    `PMO report rule catalog not found. Tried: ${candidates.join(', ')}. ` +
      'Set PMO_REPORT_RULES_DIR to a directory containing versioned JSON rule sets.',
  );
}

interface CatalogCache {
  directory: string;
  ruleSets: PmoReportRuleSet[];
}

let cachedCatalog: CatalogCache | null = null;

export interface LoadPmoReportRuleCatalogOptions {
  directory?: string;
  bypassCache?: boolean;
}

export function loadPmoReportRuleCatalog(
  options: LoadPmoReportRuleCatalogOptions = {},
): PmoReportRuleSet[] {
  const directory = resolvePmoReportRuleCatalogDir(options.directory);
  if (!options.bypassCache && cachedCatalog?.directory === directory) {
    return cachedCatalog.ruleSets;
  }

  const filenames = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const ruleSets: PmoReportRuleSet[] = [];
  const errors: string[] = [];

  for (const filename of filenames) {
    const filePath = path.join(directory, filename);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      ruleSets.push(validateRuleSet(raw));
    } catch (error) {
      errors.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`PMO report rule catalog validation failed:\n${errors.join('\n')}`);
  }
  if (ruleSets.length === 0) {
    throw new Error(`PMO report rule catalog is empty: ${directory}`);
  }

  const duplicateVersions = ruleSets
    .filter(
      (ruleSet, index) =>
        ruleSets.findIndex(
          (candidate) =>
            candidate.ruleSetId === ruleSet.ruleSetId && candidate.version === ruleSet.version,
        ) !== index,
    )
    .map((ruleSet) => `${ruleSet.ruleSetId}@${ruleSet.version}`);
  if (duplicateVersions.length > 0) {
    throw new Error(
      `PMO report rule catalog validation failed:\nduplicate rule versions: ${[
        ...new Set(duplicateVersions),
      ].join(', ')}`,
    );
  }

  cachedCatalog = { directory, ruleSets };
  return ruleSets;
}

export function resetPmoReportRuleCatalogCacheForTests(): void {
  cachedCatalog = null;
}
