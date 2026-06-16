import { AgentRegistry, type AgentTool } from '@seta/agent-sdk';
import { ingestDataWorkflowSpec } from '../workflows/ingest-data/spec.ts';
import { pmoComputeMemberWeekFactsTool } from './compute-facts.ts';
import { pmoDetectMismatchTool } from './detect-mismatch.ts';
import { pmoDetectOverbookIdleTool } from './detect-overbook-idle.ts';
import { pmoAnalyticsTools } from './index.ts';

export const pmoAgentTools: AgentTool[] = [...pmoAnalyticsTools];

// Register workflows with AgentRegistry so they appear in Workflows UI
AgentRegistry.registerWorkflow(ingestDataWorkflowSpec);

// PMO resource-monitoring specialist: turns published PMO data into utilization
// findings (overbook / idle / logged-vs-planned mismatch) with valid edge cases
// (part-time, holiday weeks, approved leave/OT, onboarding) already neutralised.
AgentRegistry.registerSpecialist({
  domain: 'work',
  id: 'pmo',
  description:
    'Resource allocation & timesheet monitoring. Detects overbooked/idle members ' +
    'and logged-vs-planned mismatches from published PMO data, excluding valid ' +
    'edge cases (leave, approved OT, holidays, part-time, onboarding).',
  instructions: () => `You are the PMO resource-monitoring specialist. You analyse
published PMO data (resource allocation + timesheets) to flag utilization issues.

## Workflow
1. Call pmo_computeMemberWeekFacts ONCE first — it (re)builds the member × week
   read-model from the latest published data. Do this before any detection.
2. Then call pmo_detectOverbookIdle and/or pmo_detectMismatch as the question needs.

## Reading findings
- Busy rate = planned ÷ standard week (part-time aware). > threshold = overbook,
  < threshold = idle.
- Effort consumption = logged ÷ expected. Outside threshold = mismatch
  (under-log or over-log).
- Every finding lists \`excludedWeeks\`: weeks neutralised as valid edge cases
  (approved_leave, approved_ot). These are NOT problems — mention them as context
  ("excluding approved OT in W5") rather than flagging them.
- A member who logged extra hours but has approved OT will NOT appear as a
  mismatch — that is correct, not a miss.

Report findings by member with the metric value and severity (RAG colour).
Surface your reasoning so the user can follow along.`,
  tools: {
    pmo_computeMemberWeekFacts: pmoComputeMemberWeekFactsTool,
    pmo_detectOverbookIdle: pmoDetectOverbookIdleTool,
    pmo_detectMismatch: pmoDetectMismatchTool,
  },
});
