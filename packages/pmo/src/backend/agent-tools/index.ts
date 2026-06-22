import type { AgentTool } from '@seta/agent-sdk';
import { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
import { pmoDetectMismatchTool } from './detect-mismatch.ts';
import { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';
import { pmoExplainFormulaTool } from './explain-formula.ts';
import { pmoGenerateReportTool } from './generate-report.ts';
import { pmoListMemberUtilizationTool } from './list-member-utilization.ts';
import { pmoRecommendRebalanceTool } from './recommend-rebalance.ts';

export { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
export { pmoDetectMismatchTool } from './detect-mismatch.ts';
export { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';
export { pmoExplainFormulaTool } from './explain-formula.ts';
export { pmoGenerateReportTool } from './generate-report.ts';
export { pmoListMemberUtilizationTool } from './list-member-utilization.ts';
export { pmoRecommendRebalanceTool } from './recommend-rebalance.ts';

/** PMO analytics agent tools (read-only; execute without HITL). */
export const pmoAnalyticsTools: AgentTool[] = [
  pmoComputeMemberWeekFactsTool,
  pmoListMemberUtilizationTool,
  pmoDetectOverbookIdleTool,
  pmoDetectMismatchTool,
  pmoExplainFormulaTool,
  pmoGenerateReportTool,
  pmoRecommendRebalanceTool,
];
