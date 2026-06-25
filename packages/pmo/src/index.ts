export { buildFindingSuggestedActions } from './backend/analytics/findings.ts';
export type { PmoActionCode, SuggestedAction } from './backend/analytics/types.ts';
export { PMO_ACTION_CODES, PMO_ACTION_TEMPLATES } from './backend/analytics/types.ts';
export type {
  DefaultThresholdConfig,
  SeedPmoDefaultThresholdConfigsInput,
  SeedPmoDefaultThresholdConfigsResult,
} from './backend/demo/default-threshold-config.ts';
export {
  loadDefaultThresholdConfigs,
  seedPmoDefaultThresholdConfigsForTenant,
} from './backend/demo/default-threshold-config.ts';
export type {
  DerivedPlannerBucketRow,
  DerivedPlannerGroupRow,
  DerivedPlannerPlanMemberRow,
  DerivedPlannerPlanRow,
  DerivedPlannerSeed,
  DerivedPlannerTaskRow,
  DerivedPlannerTimesheetRow,
  DerivedPlannerUserRow,
  DerivePlannerSeedFromMockDbInput,
} from './backend/demo/derive-planner-seed.ts';
export { derivePlannerSeedFromMockDb } from './backend/demo/derive-planner-seed.ts';
export type {
  SeedPmo02FromMockDbInput,
  SeedPmo02FromMockDbResult,
} from './backend/demo/seed-from-mock-db.ts';
export {
  BUNDLED_PMO02_MOCK_DB_RELATIVE,
  DEFAULT_PMO02_WORKBOOK_PATH,
  DEFAULT_REPO_MOCK_DB_PATH,
  ensurePmo02MockSqliteDb,
  pmoMockDbExists,
  queryMockDbJson,
  resolvePmoMockDbPath,
  seedPmo02FromMockDbForTenant,
} from './backend/demo/seed-from-mock-db.ts';
export type {
  SeedProjectDemandPlanInput,
  SeedProjectDemandPlanResult,
} from './backend/demo/seed-project-demand-plan.ts';
export { seedProjectDemandPlanForTenant } from './backend/demo/seed-project-demand-plan.ts';
export type {
  SeedRecommendationProjectionsInput,
  SeedRecommendationProjectionsResult,
} from './backend/demo/seed-recommendation-projections.ts';
export { seedRecommendationProjectionsForTenant } from './backend/demo/seed-recommendation-projections.ts';
export type {
  CreateReportRunInput,
  GenerateReportResult,
  ReportOutputFormat,
  ReportRunEnvelope,
  ReportSourceMode,
} from './backend/reporting/contracts.ts';
export { createReportRun } from './backend/reporting/generate-report.ts';
export type { ReportRunRecord, ReportRunStatus } from './backend/reporting/report-repository.ts';
export { getReportRun, retryReportRun } from './backend/reporting/report-repository.ts';
export type {
  LegacyKpiNormRow,
  LegacyThresholdConfigRow,
  LegacyThresholdValues,
  LoadPmoReportRuleCatalogOptions,
  PmoReportMetricId,
  PmoReportRagColor,
  PmoReportRuleSet,
  ReportRange,
  ReportRuleSource,
  ResolvedReportRules,
  ResolveReportRulesInput,
  RuleCompatibilityLogger,
  RuleCompatibilityMismatch,
} from './backend/reporting/rules/index.ts';
export {
  auditLegacyRuleCompatibility,
  canonicalizeReportRules,
  classifyReportMetric,
  fileReportRuleSource,
  hashReportRules,
  loadPmoReportRuleCatalog,
  mapReportRulesToLegacyThresholds,
  PMO_REPORT_METRIC_IDS,
  PmoReportRuleSetSchema,
  REPORT_METRIC_FORMULAS,
  ReportRangeSchema,
  resetPmoReportRuleCatalogCacheForTests,
  resolvePmoReportRuleCatalogDir,
  resolveReportRules,
  validateRuleSet,
} from './backend/reporting/rules/index.ts';
