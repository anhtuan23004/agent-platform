export type { AllocationRow } from '../../analytics/types.ts';
export { requiredReductionHours, simulateCapacity } from './capacity-simulation.ts';
export * from './contracts.ts';
export { applyPortfolioReservation, generateRebalanceRecommendations } from './generate.ts';
export { loadRecommendationEvidence } from './load-evidence.ts';
export { buildRebalanceOpportunities } from './opportunities.ts';
export { buildAllocationSegments, buildMemberAllocationPeriods } from './ra-segmentation.ts';
export { buildRecommendationWindow, nextWorkingDay } from './recommendation-window.ts';
export { buildCandidateSlots } from './risk-gates.ts';
export { scoreRoleCompatibility } from './role-compatibility.ts';
export { scoreSkillCoverage } from './skill-coverage.ts';
export type { SyncMemberSkillInput, SyncTaskHistoryInput } from './sync-projections.ts';
export {
  getRecommendationProjectionFreshness,
  syncMemberSkillProjection,
  syncTaskHistoryProjection,
} from './sync-projections.ts';
export { scoreTaskHistory } from './task-similarity.ts';
