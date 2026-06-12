import { describe, expect, it } from 'vitest';
import {
  assertValidTransition,
  getAllowedTransitions,
  InvalidTransitionError,
  isTerminalStatus,
} from '../../src/backend/domain/ingestion-session.ts';

describe('ingestion-session state machine', () => {
  describe('valid transitions', () => {
    it('uploaded → profiling', () => {
      expect(() => assertValidTransition('uploaded', 'profiling')).not.toThrow();
    });

    it('profiling → awaiting_confirmation', () => {
      expect(() => assertValidTransition('profiling', 'awaiting_confirmation')).not.toThrow();
    });

    it('profiling → confirmed (high confidence skip)', () => {
      expect(() => assertValidTransition('profiling', 'confirmed')).not.toThrow();
    });

    it('profiling → failed', () => {
      expect(() => assertValidTransition('profiling', 'failed')).not.toThrow();
    });

    it('awaiting_confirmation → confirmed', () => {
      expect(() => assertValidTransition('awaiting_confirmation', 'confirmed')).not.toThrow();
    });

    it('awaiting_confirmation → rejected', () => {
      expect(() => assertValidTransition('awaiting_confirmation', 'rejected')).not.toThrow();
    });

    it('confirmed → normalizing', () => {
      expect(() => assertValidTransition('confirmed', 'normalizing')).not.toThrow();
    });

    it('normalizing → staging_normalized', () => {
      expect(() => assertValidTransition('normalizing', 'staging_normalized')).not.toThrow();
    });

    it('normalizing → failed', () => {
      expect(() => assertValidTransition('normalizing', 'failed')).not.toThrow();
    });

    it('staging_normalized → awaiting_publish_review (has updates)', () => {
      expect(() =>
        assertValidTransition('staging_normalized', 'awaiting_publish_review'),
      ).not.toThrow();
    });

    it('staging_normalized → published (no review needed)', () => {
      expect(() => assertValidTransition('staging_normalized', 'published')).not.toThrow();
    });

    it('awaiting_publish_review → published (approved)', () => {
      expect(() => assertValidTransition('awaiting_publish_review', 'published')).not.toThrow();
    });

    it('awaiting_publish_review → rejected', () => {
      expect(() => assertValidTransition('awaiting_publish_review', 'rejected')).not.toThrow();
    });
  });

  describe('invalid transitions', () => {
    it('uploaded → confirmed (must go through profiling)', () => {
      expect(() => assertValidTransition('uploaded', 'confirmed')).toThrow(InvalidTransitionError);
    });

    it('confirmed → profiling (no backward)', () => {
      expect(() => assertValidTransition('confirmed', 'profiling')).toThrow(InvalidTransitionError);
    });

    it('published → anything (terminal)', () => {
      expect(() => assertValidTransition('published', 'profiling')).toThrow(InvalidTransitionError);
      expect(() => assertValidTransition('published', 'confirmed')).toThrow(InvalidTransitionError);
    });

    it('failed → anything (terminal)', () => {
      expect(() => assertValidTransition('failed', 'uploaded')).toThrow(InvalidTransitionError);
      expect(() => assertValidTransition('failed', 'profiling')).toThrow(InvalidTransitionError);
    });

    it('rejected → anything (terminal)', () => {
      expect(() => assertValidTransition('rejected', 'uploaded')).toThrow(InvalidTransitionError);
    });

    it('awaiting_confirmation → normalizing (must confirm first)', () => {
      expect(() => assertValidTransition('awaiting_confirmation', 'normalizing')).toThrow(
        InvalidTransitionError,
      );
    });
  });

  describe('terminal status', () => {
    it('published is terminal', () => {
      expect(isTerminalStatus('published')).toBe(true);
    });

    it('failed is terminal', () => {
      expect(isTerminalStatus('failed')).toBe(true);
    });

    it('rejected is terminal', () => {
      expect(isTerminalStatus('rejected')).toBe(true);
    });

    it('confirmed is not terminal', () => {
      expect(isTerminalStatus('confirmed')).toBe(false);
    });

    it('uploaded is not terminal', () => {
      expect(isTerminalStatus('uploaded')).toBe(false);
    });
  });

  describe('getAllowedTransitions', () => {
    it('returns valid next states for uploaded', () => {
      expect(getAllowedTransitions('uploaded')).toEqual(['profiling']);
    });

    it('returns empty for terminal states', () => {
      expect(getAllowedTransitions('published')).toEqual([]);
      expect(getAllowedTransitions('failed')).toEqual([]);
      expect(getAllowedTransitions('rejected')).toEqual([]);
    });

    it('returns multiple options for profiling', () => {
      const transitions = getAllowedTransitions('profiling');
      expect(transitions).toContain('awaiting_confirmation');
      expect(transitions).toContain('confirmed');
      expect(transitions).toContain('failed');
    });
  });
});
