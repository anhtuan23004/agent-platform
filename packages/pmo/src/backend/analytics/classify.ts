import type { WeekMetrics } from './metrics.ts';
import type { IssueType, RagColor, Thresholds } from './types.ts';

type Metrics = WeekMetrics;

export interface Classification {
  ragColor: RagColor;
  issueType: IssueType;
}

/**
 * Classify a member-week from busy rate and effort consumption against the
 * resolved thresholds. Busy drives overbook/idle; EC drives mismatch. Busy
 * takes precedence (capacity problem outranks logging discrepancy).
 */
export function classifyRag(metrics: Metrics, thresholds: Thresholds): Classification {
  const { busyRate, effortConsumption, plannedHours, loggedHours } = metrics;

  // ── No plan / no log (unassigned) ─────────────────────────────────────────
  // If a member has capacity but no allocations and no logs, calling them "idle"
  // creates noisy red flags for placeholder members in the roster. Treat this
  // as a data/planning gap instead; the demo UI will surface it via
  // suppressionReason = 'no_plan'.
  if (plannedHours === 0 && loggedHours === 0) {
    return { ragColor: 'none', issueType: 'ok' };
  }

  // ── Overbook / idle (busy) ────────────────────────────────────────────────
  if (busyRate !== null) {
    if (busyRate > thresholds.overbookRedThreshold) {
      return { ragColor: 'red', issueType: 'overbook' };
    }
    if (busyRate > thresholds.overbookThreshold) {
      return { ragColor: 'yellow', issueType: 'overbook' };
    }
    if (busyRate < thresholds.idleThreshold) {
      return { ragColor: 'red', issueType: 'idle' };
    }
  }

  // ── Mismatch (effort consumption) ─────────────────────────────────────────
  if (effortConsumption !== null) {
    const drift = Math.abs(effortConsumption - 1);
    if (drift > thresholds.mismatchPctThreshold) {
      return {
        ragColor: 'red',
        issueType: effortConsumption < 1 ? 'mismatch_under' : 'mismatch_over',
      };
    }
  }

  return { ragColor: 'green', issueType: 'ok' };
}
