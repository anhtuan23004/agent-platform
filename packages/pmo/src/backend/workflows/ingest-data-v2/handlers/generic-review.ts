import type { ApprovalCard } from '@seta/agent-sdk';
import type { PmoDynamicStepHandler } from '../types.ts';

export function createGenericReviewHandler(): PmoDynamicStepHandler {
  return {
    actionId: 'generic_review',
    execute: async (input) => {
      const card: ApprovalCard = {
        toolCallId: `workflow:${input.runId}:pmo_genericReview`,
        intent: `Review planner step ${input.step.step_name}`,
        riskBadge: 'write',
        summary: 'This planner step requires explicit review before continuing.',
        details: [
          {
            kind: 'kvTable',
            rows: [
              { k: 'Step', v: input.step.step_name },
              { k: 'Planner step id', v: input.step.planner_step_id },
              { k: 'Action', v: input.step.action_id },
              { k: 'Review type', v: input.step.review_type },
            ],
          },
        ],
        primary: {
          label: 'Approve and continue',
          argsPatch: {
            decision: 'approve',
            plannerStepId: input.step.planner_step_id,
          },
        },
        alternates: [],
        decline: {
          label: 'Reject step',
          argsPatch: {
            decision: 'reject',
            plannerStepId: input.step.planner_step_id,
          },
        },
        meta: {
          tenantId: input.tenantId,
          userId: input.userId,
          agentPath: ['supervisor', 'work', 'pmo'],
          toolId: 'pmo_genericReview',
          plannerStepId: input.step.planner_step_id,
          actionId: input.step.action_id,
          reviewType: input.step.review_type,
          ts: new Date().toISOString(),
        },
      };

      if (!input.resumeData) {
        return {
          kind: 'suspend',
          card,
          sessionStatus: 'awaiting_publish_review',
        };
      }

      if (input.resumeData.decision === 'reject') {
        return {
          kind: 'rejected',
          sessionStatus: 'rejected',
          terminalOutput: {
            ingestionSessionId: input.ingestionSessionId,
            status: 'rejected',
            rowsWritten: {},
            rowsUpdated: {},
            rowsSkipped: {},
          },
        };
      }

      return {
        kind: 'completed',
        sessionStatus: 'confirmed',
      };
    },
  };
}
