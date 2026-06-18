import type { AgentTool } from '@seta/agent-sdk';
import { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
import { pmoDetectMismatchTool } from './detect-mismatch.ts';
import { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';
import { pmoGenerateReportTool } from './generate-report.ts';

export { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
export { pmoDetectMismatchTool } from './detect-mismatch.ts';
export { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';
export { pmoGenerateReportTool } from './generate-report.ts';

/** PMO analytics agent tools (read-only; execute without HITL). */
export const pmoAnalyticsTools: AgentTool[] = [
  pmoComputeMemberWeekFactsTool,
  pmoDetectOverbookIdleTool,
  pmoDetectMismatchTool,
  pmoGenerateReportTool,
];
