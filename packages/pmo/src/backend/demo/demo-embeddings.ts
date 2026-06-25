export const DEMO_EMBEDDING_MODEL_ID = 'pmo02-deterministic-mock-v1';
export const DEMO_EMBEDDING_DIMENSIONS = 32;

/** Deterministic unit vector for local/demo rebalance scoring (no OpenAI call). */
export function deterministicEmbeddingFromHash(
  sourceHash: string,
  dimensions = DEMO_EMBEDDING_DIMENSIONS,
): number[] {
  const normalized = sourceHash.trim().toLowerCase();
  if (!normalized) return [];

  const vector = Array.from({ length: dimensions }, (_, index) => {
    let value = 0;
    for (let offset = 0; offset < normalized.length; offset += 1) {
      value += normalized.charCodeAt(offset) * (index + 1 + offset);
    }
    return Math.sin(value) * 0.5 + Math.cos(value / 3) * 0.5;
  });

  const norm = Math.sqrt(vector.reduce((sum, component) => sum + component ** 2, 0));
  if (norm <= 0) return vector;
  return vector.map((component) => component / norm);
}
