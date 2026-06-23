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
    'PMO utilization analytics over published data — overbooked/idle members, ' +
    'logged-vs-planned effort mismatch, rebalance recommendations, utilization reports, ' +
    'and formula/rule explanations.',
  instructions: () =>
    'You are the PMO Agent. Answer utilization questions via pmo_queryUtilization (explicit intent) over published PMO data. For roles/staffing use Staffing Agent; for ingest use /pmo. Never invent numbers.',
  tools: Object.fromEntries(pmoAnalyticsTools.map((tool) => [(tool as { id: string }).id, tool])),
});

// Register workflows with AgentRegistry so they appear in Workflows UI
AgentRegistry.registerWorkflow(ingestDataV2WorkflowSpec);
AgentRegistry.registerWorkflowSnapshotDecorator(pmoPlannerSnapshotDecorator);
