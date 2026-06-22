export interface FindingExplanation {
  summary: string;
  riskTradeoffs: string[];
}

export interface RecommendationGroupExplanation {
  summary: string;
  riskTradeoffs: string[];
  topChoiceReason: string | null;
  alternativesComparison: string | null;
}
