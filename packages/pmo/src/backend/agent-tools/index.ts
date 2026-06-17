import type { AgentTool } from '@seta/agent-sdk';
import { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
import { pmoDetectMismatchTool } from './detect-mismatch.ts';
import { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';

export { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
export { pmoDetectMismatchTool } from './detect-mismatch.ts';
export { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';

/** PMO analytics agent tools (read-only; execute without HITL). */
export const pmoAnalyticsTools: AgentTool[] = [
  pmoComputeMemberWeekFactsTool,
  pmoDetectOverbookIdleTool,
  pmoDetectMismatchTool,
];
