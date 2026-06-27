import { describe, expect, it } from 'vitest';
import {
  DEMO_EMBEDDING_DIMENSIONS,
  deterministicEmbeddingFromHash,
} from '../../../src/backend/demo/demo-embeddings.ts';

describe('deterministicEmbeddingFromHash', () => {
  it('returns a normalized vector with stable dimensions', () => {
    const first = deterministicEmbeddingFromHash('abc123');
    const second = deterministicEmbeddingFromHash('abc123');

    expect(first).toHaveLength(DEMO_EMBEDDING_DIMENSIONS);
    expect(second).toEqual(first);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value ** 2, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('returns an empty vector for blank hashes', () => {
    expect(deterministicEmbeddingFromHash('')).toEqual([]);
  });
});
