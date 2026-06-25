/**
 * Smoke-test tool for PMO native-suspend HITL. Verifies the round-trip:
 *   chat message → tool suspend → card rendered → approve → agent resumes.
 *
 * TEMPORARY — removed after Phase 0 verification.
 */
import type { ApprovalCard } from '@seta/agent-sdk';
import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';

const SuspendSchema = z.object({ card: z.unknown() });

const ResumeSchema = z.object({
  decision: z.enum(['approve', 'reject', 'modify']),
  note: z.string().optional(),
});

const InputSchema = z.object({
  message: z.string().describe('A test message to echo back through the approval card'),
});

const OutputSchema = z.object({
  echoed: z.string(),
  decision: z.string(),
  note: z.string().optional(),
});

export function makePmoEchoSuspendTool() {
  return defineAgentTool({
    id: 'pmo_echoSuspend',
    name: 'Echo with Approval',
    description:
      'DEV-ONLY smoke test. Echoes a message through a native-suspend approval card. ' +
      'Triggers when the user says "test suspend" or "echo suspend".',
    input: InputSchema,
    output: OutputSchema,
    suspendSchema: SuspendSchema,
    resumeSchema: ResumeSchema,
    execute: async (input, toolCtx) => {
      const agent = toolCtx.agent;
      const resume = agent?.resumeData;

      // ── Resume pass ──
      if (resume) {
        return {
          echoed: input.message,
          decision: resume.decision,
          note: resume.note,
        };
      }

      // ── First pass: build card and suspend ──
      const card: ApprovalCard = {
        toolCallId: 'pmo_echoSuspend',
        intent: 'Review echo test',
        riskBadge: 'write',
        summary: `Smoke-test card: "${input.message}"`,
        details: [
          {
            kind: 'kvTable',
            rows: [
              { k: 'Tool', v: 'pmo_echoSuspend' },
              { k: 'Message', v: input.message },
              { k: 'Timestamp', v: new Date().toISOString() },
            ],
          },
        ],
        primary: { label: 'Approve echo' },
        alternates: [],
        decline: { label: 'Reject echo' },
        meta: {
          tenantId: '',
          userId: '',
          agentPath: ['pmo.orchestrator'],
          toolId: 'pmo_echoSuspend',
          ts: new Date().toISOString(),
        },
      };

      if (typeof agent?.suspend !== 'function') {
        throw new Error('pmo_echoSuspend: ctx.agent.suspend unavailable');
      }
      await agent.suspend({ card });
      // Unreachable — Mastra throws at suspend().
      return { echoed: input.message, decision: 'unreachable' };
    },
  });
}
