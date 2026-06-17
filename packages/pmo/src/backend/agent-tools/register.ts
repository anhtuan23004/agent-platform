import { AgentRegistry, type AgentTool } from '@seta/agent-sdk';
import { ingestDataV2WorkflowSpec } from '../workflows/ingest-data-v2/spec.ts';
import { pmoPlannerSnapshotDecorator } from '../workflows/planner-snapshot-decorator.ts';
import { pmoAnalyticsTools } from './index.ts';

export const pmoAgentTools: AgentTool[] = [...pmoAnalyticsTools];

// Register workflows with AgentRegistry so they appear in Workflows UI
AgentRegistry.registerWorkflow(ingestDataV2WorkflowSpec);
AgentRegistry.registerWorkflowSnapshotDecorator(pmoPlannerSnapshotDecorator);
