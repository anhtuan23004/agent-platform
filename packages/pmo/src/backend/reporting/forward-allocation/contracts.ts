import type { ReportMemberEvidence } from '../../analytics/load-report-evidence.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberWeekFact,
  ProjectRow,
  WeekRow,
} from '../../analytics/types.ts';
import type { MemberSkillEvidence, TaskHistoryEvidence } from '../recommendations/contracts.ts';

export type ForwardAllocationRecommendationMode = 'demand_backed' | 'inferred';

export interface ForwardAllocationWindow {
  evidenceFrom: Date;
  evidenceTo: Date;
  planningStart: Date;
  planningEnd: Date;
}

export interface ForwardAllocationMember extends ReportMemberEvidence {}

export interface ForwardAllocationProject extends ProjectRow {
  project_domain: string | null;
}

export interface ForwardAllocationDemandWindow {
  demandId: string;
  projectId: string;
  roleNeeded: string;
  requiredSkills: string[];
  demandStart: Date;
  demandEnd: Date;
  demandPct: number | null;
  demandHoursPerWeek: number | null;
  urgency: string;
  priorityScore: number | null;
  confirmed: boolean;
  demandSource: string;
  note: string | null;
  evidenceFlags: string[];
}

export interface ProjectDemandGapWindow {
  demandId: string;
  projectId: string;
  roleNeeded: string;
  requiredSkills: string[];
  demandStart: Date;
  demandEnd: Date;
  demandPct: number;
  demandHoursPerWeek: number;
  urgency: string;
  priorityScore: number | null;
  confirmed: boolean;
  recommendationMode: ForwardAllocationRecommendationMode;
  demandSource: string;
  note: string | null;
  evidenceFlags: string[];
  supportingAllocationPct: number;
  unresolvedDemandPct: number;
  unresolvedDemandHoursPerWeek: number;
  recommendationTypeHint: 'extend' | 'reassign' | 'fill_gap';
}

export interface ForwardAllocationRiskSummary {
  memberId: string;
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  utilization: number | null;
  effortConsumption: number | null;
  overtimeRatio: number | null;
  trainingHours: number;
  benchHours: number;
}

export interface MemberAvailabilityWindow {
  memberId: string;
  currentProjectId: string | null;
  assignmentEndDate: Date | null;
  availableFrom: Date;
  availableTo: Date | null;
  currentRaBusyRate: number;
  availableCapacityPct: number;
  availableCapacityHoursPerWeek: number;
  actualUtilization: number | null;
  overtimeRatio: number | null;
  leaveConflicts: Array<{ from: Date; to: Date; reason: string }>;
  riskFlags: string[];
  evidenceFlags: string[];
  availabilityKind: 'assignment_end' | 'partial_capacity';
}

export interface ForwardAllocationModeSummary {
  demandBackedCount: number;
  inferredCount: number;
}

export interface ForwardAllocationEvidence {
  window: ForwardAllocationWindow;
  modeSummary: ForwardAllocationModeSummary;
  facts: MemberWeekFact[];
  weeks: WeekRow[];
  leaves: LeaveRow[];
  members: ForwardAllocationMember[];
  projects: ForwardAllocationProject[];
  allocations: AllocationRow[];
  demandWindows: ForwardAllocationDemandWindow[];
  demandGaps: ProjectDemandGapWindow[];
  riskByMember: Map<string, ForwardAllocationRiskSummary>;
  skills: MemberSkillEvidence[];
  taskHistory: TaskHistoryEvidence[];
}

export interface ForwardAllocationScoreBreakdown {
  availabilityOverlap: number;
  roleSkillMatch: number;
  demandUrgency: number;
  historicalFit: number;
  workloadBalance: number;
}

export interface ForwardAllocationRecommendationRow {
  recommendationId: string;
  type: 'reassign' | 'extend' | 'fill_gap' | 'release_warning';
  confidence: 'high' | 'medium' | 'low';
  recommendationMode: ForwardAllocationRecommendationMode;
  memberId: string;
  currentProjectId: string | null;
  assignmentEndDate: string | null;
  availableFrom: string | null;
  targetProjectId: string | null;
  suggestedAllocationPct: number | null;
  suggestedAllocationHoursPerWeek: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  score: number;
  scoreBreakdown: ForwardAllocationScoreBreakdown;
  expectedBusyRateAfterAllocation: number | null;
  hardConstraintFlags: string[];
  dataQualityFlags: string[];
  rationale: string;
  risks: string[];
  explanation?: {
    summary: string;
    riskTradeoffs: string[];
  };
  evidence: {
    demandId: string | null;
    demandStart: string | null;
    demandEnd: string | null;
    currentRaBusyRate: number | null;
    demandHoursPerWeek: number | null;
    matchedSkills: string[];
    missingSkills: string[];
    similarPastTasks: string[];
  };
}
