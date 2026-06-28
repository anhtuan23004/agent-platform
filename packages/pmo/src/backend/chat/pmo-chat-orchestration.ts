import type { MastraModelConfig } from '@mastra/core/llm';
import type { MastraCompositeStore } from '@mastra/core/storage';
import type { MastraModelOutput } from '@mastra/core/stream';
import type { AgentTool, TrustEnvelope } from '@seta/agent-sdk';
import type { ChatStreamRun, RunCtx } from '@seta/shared-orchestration';
import {
  makePmoChatOrchestrationResumer,
  makePmoChatOrchestrationStreamer,
  type PmoOrchestratorRunCtx,
  type PmoResumeDecision,
} from '../orchestration/orchestrator.ts';

/** PMO Agent: orchestrator over published PMO utilization data, with
 *  native-suspend HITL support for agentic ingestion tools. */

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
  /** Resumes a suspended native-suspend PMO orchestrator run (the chat-HITL
   *  approval continuation). */
  runResume: (
    resume: PmoResumeDecision,
    ctx: RunCtx & { mastraRunId: string; toolCallId?: string },
  ) => Promise<ChatStreamRun>;
}

export interface PmoChatOrchestrationDeps {
  resolveModel: () => MastraModelConfig;
  /** Store the per-turn Mastra wraps so its native-suspend snapshot persists.
   *  Shared with the engine Mastra for cross-instance resume. */
  mastraStorage: MastraCompositeStore;
  extraTools?: AgentTool[];
  resolveExtraTools?: () => AgentTool[];
}

export function buildPmoChatOrchestrationRuntime(
  deps: PmoChatOrchestrationDeps,
): PmoChatOrchestrationRuntime {
  const orchDeps = {
    resolveModel: deps.resolveModel,
    mastraStorage: deps.mastraStorage,
  };
  const streamChat = makePmoChatOrchestrationStreamer(orchDeps);
  const resumeChat = makePmoChatOrchestrationResumer(orchDeps);

  return {
    runStream: (input, ctx) => streamChat(input, ctx) as Promise<PmoChatStreamRun>,
    runResume: resumeChat,
  };
}
