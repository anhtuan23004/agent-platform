import type { MastraModelConfig } from '@mastra/core/llm';
import type { MastraModelOutput } from '@mastra/core/stream';
import type { AgentTool, TrustEnvelope } from '@seta/agent-sdk';
import {
  buildPmoOrchestratorStreamRun,
  type PmoOrchestratorRunCtx,
} from '../orchestration/orchestrator.ts';

/** PMO Agent: thin orchestrator over published PMO utilization data. */

export interface PmoChatRunCtx extends PmoOrchestratorRunCtx {}

export interface PmoChatStreamRun {
  output: MastraModelOutput<unknown>;
  finalize: () => Promise<{ result: unknown; trust: TrustEnvelope }>;
}

export interface PmoChatOrchestrationRuntime {
  runStream: (
    input: { userText: string; taskId: string | null },
    ctx: PmoChatRunCtx,
  ) => Promise<PmoChatStreamRun>;
}

export interface PmoChatOrchestrationDeps {
  resolveModel: () => MastraModelConfig;
  extraTools?: AgentTool[];
  resolveExtraTools?: () => AgentTool[];
}

export function buildPmoChatOrchestrationRuntime(
  deps: PmoChatOrchestrationDeps,
): PmoChatOrchestrationRuntime {
  return {
    runStream: (input, ctx) =>
      buildPmoOrchestratorStreamRun(
        { resolveModel: deps.resolveModel },
        input,
        ctx,
      ) as Promise<PmoChatStreamRun>,
  };
}
