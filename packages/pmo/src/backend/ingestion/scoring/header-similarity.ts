import type { CanonicalField } from '../canonical-schema.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HeaderScoreResult {
  score: number; // 0–1
  method: 'exact' | 'synonym' | 'abbreviation' | 'fuzzy' | 'none';
  matchedSynonym: string | null;
}

// ── Abbreviation expansions ──────────────────────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  emp: 'employee',
  hrs: 'hours',
  hr: 'hours',
  pct: 'percent',
  perc: 'percent',
  alloc: 'allocation',
  proj: 'project',
  mgr: 'manager',
  dept: 'department',
  desc: 'description',
  ref: 'reference',
  cat: 'category',
  ot: 'overtime',
  ft: 'full time',
  pt: 'part time',
  wk: 'week',
  std: 'standard',
};

// ── Normalization ────────────────────────────────────────────────────────────

function normalize(term: string): string {
  return term
    .toLowerCase()
    .replace(/[_\-./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandAbbreviations(term: string): string {
  const tokens = term.split(/\s+/);
  const expanded = tokens.map((t) => ABBREVIATIONS[t] ?? t);
  return expanded.join(' ');
}

// ── Fuzzy matching ───────────────────────────────────────────────────────────

function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter((t) => t.length > 0));
  const tokensB = new Set(b.split(/\s+/).filter((t) => t.length > 0));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  return (2 * intersection) / (tokensA.size + tokensB.size);
}

function fuzzyToScore(ratio: number): number {
  if (ratio >= 0.93) return 0.9;
  if (ratio >= 0.88) return 0.85;
  if (ratio >= 0.8) return 0.75;
  if (ratio >= 0.65) return 0.55;
  if (ratio >= 0.5) return 0.35;
  return 0.0;
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreHeaderSimilarity(
  sourceHeader: string,
  canonicalField: CanonicalField,
): HeaderScoreResult {
  const normalizedSource = normalize(sourceHeader);

  // 1. Exact match against canonical field name
  const normalizedFieldName = normalize(canonicalField.name);
  if (normalizedSource === normalizedFieldName) {
    return { score: 1.0, method: 'exact', matchedSynonym: canonicalField.name };
  }

  // 2. Exact match against each synonym
  for (const synonym of canonicalField.synonyms) {
    const normalizedSynonym = normalize(synonym);
    if (normalizedSource === normalizedSynonym) {
      return { score: 0.95, method: 'synonym', matchedSynonym: synonym };
    }
  }

  // 3. Match after abbreviation expansion
  const expandedSource = expandAbbreviations(normalizedSource);

  if (expandedSource !== normalizedSource) {
    if (expandedSource === normalizedFieldName) {
      return { score: 0.9, method: 'abbreviation', matchedSynonym: canonicalField.name };
    }
    for (const synonym of canonicalField.synonyms) {
      const normalizedSynonym = normalize(synonym);
      if (expandedSource === normalizedSynonym) {
        return { score: 0.9, method: 'abbreviation', matchedSynonym: synonym };
      }
      // Also try expanding the synonym
      const expandedSynonym = expandAbbreviations(normalizedSynonym);
      if (expandedSource === expandedSynonym) {
        return { score: 0.9, method: 'abbreviation', matchedSynonym: synonym };
      }
    }
  }

  // 4. Fuzzy match (token set ratio) against field name + all synonyms
  let bestFuzzyScore = 0;
  let bestFuzzyMatch: string | null = null;

  const allTerms = [canonicalField.name, ...canonicalField.synonyms];
  for (const term of allTerms) {
    const normalizedTerm = normalize(term);

    // Try both raw and expanded forms
    const ratioRaw = tokenSetRatio(normalizedSource, normalizedTerm);
    const ratioExpanded =
      expandedSource !== normalizedSource
        ? tokenSetRatio(expandedSource, normalizedTerm)
        : ratioRaw;
    const expandedTerm = expandAbbreviations(normalizedTerm);
    const ratioTermExpanded =
      expandedTerm !== normalizedTerm ? tokenSetRatio(normalizedSource, expandedTerm) : 0;

    const bestRatio = Math.max(ratioRaw, ratioExpanded, ratioTermExpanded);
    const score = fuzzyToScore(bestRatio);

    if (score > bestFuzzyScore) {
      bestFuzzyScore = score;
      bestFuzzyMatch = term;
    }
  }

  if (bestFuzzyScore > 0) {
    return { score: bestFuzzyScore, method: 'fuzzy', matchedSynonym: bestFuzzyMatch };
  }

  return { score: 0, method: 'none', matchedSynonym: null };
}
