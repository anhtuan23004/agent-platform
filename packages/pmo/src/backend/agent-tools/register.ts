import { AgentRegistry, type AgentTool } from '@seta/agent-sdk';
import { ingestDataWorkflowSpec } from '../workflows/ingest-data/spec.ts';
import { pmoPlannerSnapshotDecorator } from '../workflows/planner-snapshot-decorator.ts';

export const pmoAgentTools: AgentTool[] = [];

// Register workflows with AgentRegistry so they appear in Workflows UI
AgentRegistry.registerWorkflow(ingestDataWorkflowSpec);
AgentRegistry.registerWorkflowSnapshotDecorator(pmoPlannerSnapshotDecorator);
