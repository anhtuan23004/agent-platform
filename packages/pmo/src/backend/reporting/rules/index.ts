export { canonicalizeReportRules, hashReportRules } from './canonical.ts';
export type {
  LegacyKpiNormRow,
  LegacyThresholdConfigRow,
  LegacyThresholdValues,
  RuleCompatibilityLogger,
  RuleCompatibilityMismatch,
} from './compatibility.ts';
export {
  auditLegacyRuleCompatibility,
  mapReportRulesToLegacyThresholds,
} from './compatibility.ts';
export type { LoadPmoReportRuleCatalogOptions } from './load.ts';
export {
  loadPmoReportRuleCatalog,
  resetPmoReportRuleCatalogCacheForTests,
  resolvePmoReportRuleCatalogDir,
} from './load.ts';
export type {
  ReportRuleSource,
  ResolvedReportRules,
  ResolveReportRulesInput,
} from './resolve.ts';
export { fileReportRuleSource, resolveReportRules } from './resolve.ts';
export type {
  PmoReportMetricId,
  PmoReportRagColor,
  PmoReportRuleSet,
  ReportRange,
} from './schema.ts';
export {
  classifyReportMetric,
  PMO_REPORT_METRIC_IDS,
  PmoReportRuleSetSchema,
  REPORT_METRIC_FORMULAS,
  ReportRangeSchema,
  validateRuleSet,
} from './schema.ts';
