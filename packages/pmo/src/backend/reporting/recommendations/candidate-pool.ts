import type { MemberWeekFact } from '../../analytics/types.ts';
import type { RecommendationMember } from './contracts.ts';

export function buildCandidatePool(input: {
  sourceMemberId: string;
  weekId: string;
  facts: MemberWeekFact[];
  members: RecommendationMember[];
}): MemberWeekFact[] {
  const activeIds = new Set(input.members.map((member) => member.memberId));
  return input.facts
    .filter(
      (fact) =>
        fact.weekId === input.weekId &&
        fact.memberId !== input.sourceMemberId &&
        fact.scopeStatus === 'IN_SCOPE' &&
        fact.availableHours > 0 &&
        activeIds.has(fact.memberId),
    )
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
}
