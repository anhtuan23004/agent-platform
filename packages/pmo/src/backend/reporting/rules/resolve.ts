import { canonicalizeReportRules, hashReportRules } from './canonical.ts';
import { loadPmoReportRuleCatalog } from './load.ts';
import { type PmoReportRuleSet, validateRuleSet } from './schema.ts';

export interface ReportRuleSource {
  listRuleSets(input: { tenantId: string }): Promise<unknown[]> | unknown[];
}

export interface ResolveReportRulesInput {
  tenantId: string;
  effectiveAt?: Date;
  source?: ReportRuleSource;
}

export interface ResolvedReportRules extends PmoReportRuleSet {
  canonicalJson: string;
  sha256: string;
}

export const fileReportRuleSource: ReportRuleSource = {
  listRuleSets: () => loadPmoReportRuleCatalog(),
};

function effectiveTime(ruleSet: PmoReportRuleSet): number {
  return new Date(`${ruleSet.effectiveFrom}T00:00:00.000Z`).getTime();
}

export async function resolveReportRules(
  input: ResolveReportRulesInput,
): Promise<ResolvedReportRules> {
  if (!input.tenantId.trim()) throw new Error('report_rules_tenant_id_required');
  const effectiveAt = input.effectiveAt ?? new Date();
  if (Number.isNaN(effectiveAt.getTime())) throw new Error('report_rules_invalid_effective_date');

  const rawRuleSets = await (input.source ?? fileReportRuleSource).listRuleSets({
    tenantId: input.tenantId,
  });
  const ruleSets = rawRuleSets.map((ruleSet) => validateRuleSet(ruleSet));
  const selected = ruleSets
    .filter((ruleSet) => effectiveTime(ruleSet) <= effectiveAt.getTime())
    .sort(
      (left, right) =>
        effectiveTime(right) - effectiveTime(left) || right.version.localeCompare(left.version),
    )[0];

  if (!selected) {
    throw new Error(`report_rules_no_applicable_version:${effectiveAt.toISOString().slice(0, 10)}`);
  }

  const canonicalJson = canonicalizeReportRules(selected);
  return {
    ...selected,
    canonicalJson,
    sha256: hashReportRules(selected),
  };
}
