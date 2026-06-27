import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { pmoDb } from '../../db/client.ts';
import { projectDemandPlan } from '../../db/schema.ts';

export interface ProjectDemandPlanRow {
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
}

export async function loadProjectDemandPlan(input: {
  tenantId: string;
  from: Date;
  to: Date;
}): Promise<ProjectDemandPlanRow[]> {
  const db = pmoDb();
  const rows = await db
    .select({
      demandId: projectDemandPlan.demand_id,
      projectId: projectDemandPlan.project_id,
      roleNeeded: projectDemandPlan.role_needed,
      requiredSkills: projectDemandPlan.required_skills,
      demandStart: projectDemandPlan.demand_start,
      demandEnd: projectDemandPlan.demand_end,
      demandPct: projectDemandPlan.demand_pct,
      demandHoursPerWeek: projectDemandPlan.demand_hours_per_week,
      urgency: projectDemandPlan.urgency,
      priorityScore: projectDemandPlan.priority_score,
      confirmed: projectDemandPlan.confirmed,
      demandSource: projectDemandPlan.demand_source,
      note: projectDemandPlan.note,
    })
    .from(projectDemandPlan)
    .where(
      and(
        eq(projectDemandPlan.tenant_id, input.tenantId),
        eq(projectDemandPlan.is_active, true),
        gte(projectDemandPlan.demand_end, input.from),
        lte(projectDemandPlan.demand_start, input.to),
      ),
    )
    .orderBy(asc(projectDemandPlan.demand_id));

  return rows.map((row) => ({
    ...row,
    requiredSkills: Array.isArray(row.requiredSkills) ? row.requiredSkills : [],
  }));
}
