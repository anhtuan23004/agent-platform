import { z } from 'zod';
import { PMO_PLAN_ACTION_IDS, PMO_REVIEW_TYPES } from './step-metadata.ts';

export const PlanDataAreaSchema = z.enum([
  'resource_allocation',
  'timesheet',
  'overbook_idle_config',
  'member_master',
  'project_master',
  'leave',
  'calendar_weeks',
  'kpi_norms',
  'unknown',
]);

export const PlanConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const ReviewActionSchema = z.enum(['approve', 'modify', 'regenerate', 'reject', 'continue']);

export const RiskTypeSchema = z.enum(['risk', 'assumption', 'missing_information']);

export const ImpactSchema = z.enum(['low', 'medium', 'high']);

export const WorkflowStepSchema = z.object({
  step_no: z.number().int().positive(),
  planner_step_id: z.string().min(1).optional(),
  action_id: z.enum(PMO_PLAN_ACTION_IDS).optional(),
  review_type: z.enum(PMO_REVIEW_TYPES).optional(),
  step_name: z.string().min(1),
  description: z.string().min(1),
  agent_responsibility: z.string().min(1),
  user_responsibility: z.string().min(1),
  requires_user_review: z.boolean(),
});

export const ReviewGateSchema = z.object({
  gate_name: z.string().min(1),
  when_it_happens: z.string().min(1),
  what_user_reviews: z.string().min(1),
  available_actions: z.array(ReviewActionSchema).min(1),
});

export const ScopeAssumptionSchema = z.object({
  likely_data_areas: z
    .array(
      z.object({
        data_area: PlanDataAreaSchema,
        reason: z.string().min(1),
        confidence: PlanConfidenceSchema,
      }),
    )
    .min(1),
  basis: z.string().min(1),
});

export const StateManagementPlanSchema = z.object({
  state_to_save: z.array(z.string().min(1)).min(1),
  resume_behavior: z.string().min(1),
});

export const RiskOrAssumptionSchema = z.object({
  type: RiskTypeSchema,
  description: z.string().min(1),
  impact: ImpactSchema,
  how_it_will_be_handled_later: z.string().min(1),
});

export const ApprovalPolicySchema = z.object({
  can_continue_after_plan_approval: z.boolean(),
  requires_mapping_review_before_normalization: z.boolean(),
  requires_db_change_review_before_publish: z.boolean(),
  will_publish_without_user_approval: z.boolean(),
});

export const NextActionSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

export const PmoWorkflowPlanSchema = z.object({
  title: z.string().min(1),
  goal_summary: z.string().min(1),
  uploaded_file_summary: z.object({
    file_name: z.string().min(1),
    file_size: z.string().min(1),
    uploaded_at: z.string().min(1),
    file_type: z.string().min(1),
  }),
  scope_assumption: ScopeAssumptionSchema,
  proposed_workflow: z.array(WorkflowStepSchema).min(1),
  review_gates: z.array(ReviewGateSchema).min(1),
  state_management_plan: StateManagementPlanSchema,
  risks_and_assumptions: z.array(RiskOrAssumptionSchema).min(1),
  not_yet_performed: z.array(z.string().min(1)).min(1),
  approval_policy: ApprovalPolicySchema,
  next_action: NextActionSchema,
});

export type PmoWorkflowPlan = z.infer<typeof PmoWorkflowPlanSchema>;
