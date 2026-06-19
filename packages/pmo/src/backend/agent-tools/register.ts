import { AgentRegistry, type AgentTool } from '@seta/agent-sdk';
import { ingestDataV2WorkflowSpec } from '../workflows/ingest-data-v2/spec.ts';
import { pmoPlannerSnapshotDecorator } from '../workflows/planner-snapshot-decorator.ts';
import { pmoAnalyticsTools } from './index.ts';

export const pmoAgentTools: AgentTool[] = [...pmoAnalyticsTools];

// The PMO Agent: backs the tool catalogue + capability listing. The chat path
// itself runs the dedicated PMO chat runtime (buildPmoChatOrchestrationRuntime),
// bound by apps/server — mirroring how staffing's catalogue entry and chat
// orchestration are separate.
AgentRegistry.registerSpecialist({
  domain: 'work',
  id: 'pmo',
  description:
    'PMO utilization analytics and chat-driven data ingest — overbooked/idle members, ' +
    'logged-vs-planned effort mismatch, utilization reports, and workbook ingest from chat.',
  instructions: () =>
    'You are the PMO Agent. Answer utilization questions using the pmo_* tools, start ingest ' +
    'with pmo_startIngest when a workbook session is provided, and never invent numbers.',
  tools: Object.fromEntries(pmoAnalyticsTools.map((tool) => [(tool as { id: string }).id, tool])),
});

// Register workflows with AgentRegistry so they appear in Workflows UI
AgentRegistry.registerWorkflow(ingestDataV2WorkflowSpec);
AgentRegistry.registerWorkflowSnapshotDecorator(pmoPlannerSnapshotDecorator);
