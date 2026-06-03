// lib/worker-stats/commitment-index.ts
//
// Commitment Index — WREDD's internal worker reliability scorer.
//
// Score: 0–100 (integer)
// Labels: Exceptional | Reliable | Developing | At Risk | Unrated
//
// ── Signals & base weights ──────────────────────────────────────────────────
//   Completion rate       40%   (completed / totalConcluded)
//   On-time delivery      30%   (gradient: 0–100 based on lateness ratio)
//   Low revision rate     20%   (1 − revisionRate)
//   BD rating average     10%   (avgRating mapped 1–5 → 0–100)
//
// ── On-time scoring (v2) ────────────────────────────────────────────────────
//   No longer binary. Uses avgOnTimeScore from assignments.ts, which is the
//   mean of per-assignment gradient scores based on hoursLate / deadlineHours.
//   See assignments.ts for bracket definitions.
//
// ── Missing signal handling ─────────────────────────────────────────────────
//   If a signal cannot be computed (no deadline projects, no ratings, etc.)
//   its weight is redistributed proportionally across the remaining signals.
//
// ── Minimum data threshold ──────────────────────────────────────────────────
//   Workers with fewer than MIN_ASSIGNMENTS_FOR_SCORE concluded assignments
//   receive score=null and label="Unrated".

import type { WorkerAssignmentStats } from "./assignments";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum concluded assignments before a score is issued */
export const MIN_ASSIGNMENTS_FOR_SCORE = 3;

export const SCORE_THRESHOLDS = {
  EXCEPTIONAL : 90,
  RELIABLE    : 75,
  DEVELOPING  : 60,
  // Below 60 → At Risk
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CommitmentLabel =
  | "Exceptional"
  | "Reliable"
  | "Developing"
  | "At Risk"
  | "Unrated";

/** Per-signal detail — shown in the breakdown panel on performance pages */
export type CommitmentSignal = {
  /** 0–100 score for this signal, null if not computable */
  score: number | null;
  /** Effective weight actually applied after redistribution (0–1) */
  effectiveWeight: number;
  /** Base weight before redistribution (0–1) */
  baseWeight: number;
  /** Whether this signal was available for this worker */
  available: boolean;
};

export type CommitmentIndex = {
  /** 0–100 rounded integer, null when unrated */
  score: number | null;
  label: CommitmentLabel;
  isUnrated: boolean;

  /** Individual signal breakdown for the detail/tooltip view */
  signals: {
    completion : CommitmentSignal; // 40%
    onTime     : CommitmentSignal; // 30%
    revision   : CommitmentSignal; // 20%
    rating     : CommitmentSignal; // 10%
  };

  /** Pass-through context (useful for rendering raw numbers beside the score) */
  totalConcluded: number;
  completed: number;
  cancelledByWorker: number;
  cancellationRate: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function labelFromScore(score: number): CommitmentLabel {
  if (score >= SCORE_THRESHOLDS.EXCEPTIONAL) return "Exceptional";
  if (score >= SCORE_THRESHOLDS.RELIABLE)    return "Reliable";
  if (score >= SCORE_THRESHOLDS.DEVELOPING)  return "Developing";
  return "At Risk";
}

/**
 * Maps a 1–5 star rating to a 0–100 score.
 * 1 star → 0, 5 stars → 100
 */
function ratingToScore(avg: number): number {
  return ((avg - 1) / 4) * 100;
}

/**
 * Weighted average with automatic weight redistribution
 * when some signals are unavailable (null).
 */
function weightedScore(
  entries: { value: number | null; weight: number }[]
): { score: number; effectiveWeights: number[] } {
  const available = entries.map((e) => e.value !== null);
  const totalAvailableWeight = entries.reduce(
    (sum, e, i) => sum + (available[i] ? e.weight : 0),
    0
  );

  if (totalAvailableWeight === 0) {
    return { score: 0, effectiveWeights: entries.map(() => 0) };
  }

  const effectiveWeights = entries.map((e, i) =>
    available[i] ? e.weight / totalAvailableWeight : 0
  );

  const score = entries.reduce(
    (sum, e, i) => sum + (available[i] ? (e.value as number) * effectiveWeights[i] : 0),
    0
  );

  return { score, effectiveWeights };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scorer
// ─────────────────────────────────────────────────────────────────────────────

export function computeCommitmentIndex(
  stats: WorkerAssignmentStats
): CommitmentIndex {
  const {
    totalConcluded,
    completed,
    cancelledByWorker,
    cancellationRate,
    completionRate,
    onTimeEligible,
    avgOnTimeScore,
    revisionRate,
    avgRating,
  } = stats;

  // ── Unrated guard ─────────────────────────────────────────────────────────
  if (totalConcluded < MIN_ASSIGNMENTS_FOR_SCORE) {
    const unratedSignal: CommitmentSignal = {
      score: null,
      effectiveWeight: 0,
      baseWeight: 0,
      available: false,
    };
    return {
      score: null,
      label: "Unrated",
      isUnrated: true,
      signals: {
        completion : unratedSignal,
        onTime     : unratedSignal,
        revision   : unratedSignal,
        rating     : unratedSignal,
      },
      totalConcluded,
      completed,
      cancelledByWorker,
      cancellationRate,
    };
  }

  // ── Signal scores (0–100) ─────────────────────────────────────────────────

  // 1) Completion rate — always available once we pass the unrated guard
  const completionScore = completionRate * 100;

  // 2) On-time delivery — gradient average; null if no deadline projects
  //    avgOnTimeScore is already 0–100 from assignments.ts
  const onTimeScore = onTimeEligible > 0 ? (avgOnTimeScore ?? 0) : null;

  // 3) Revision rate — invert so fewer revisions = higher score
  const revisionScore = completed > 0 ? (1 - revisionRate) * 100 : null;

  // 4) BD rating — only if at least one project was rated
  const ratingScore = avgRating !== null ? ratingToScore(avgRating) : null;

  // ── Weighted average with redistribution ──────────────────────────────────
  const BASE_WEIGHTS = {
    completion : 0.40,
    onTime     : 0.30,
    revision   : 0.20,
    rating     : 0.10,
  };

  const entries = [
    { value: completionScore, weight: BASE_WEIGHTS.completion },
    { value: onTimeScore,     weight: BASE_WEIGHTS.onTime     },
    { value: revisionScore,   weight: BASE_WEIGHTS.revision   },
    { value: ratingScore,     weight: BASE_WEIGHTS.rating     },
  ];

  const { score: rawScore, effectiveWeights } = weightedScore(entries);
  const finalScore = Math.round(Math.min(100, Math.max(0, rawScore)));

  // ── Build signal objects ──────────────────────────────────────────────────
  const makeSignal = (
    value: number | null,
    baseWeight: number,
    effectiveWeight: number
  ): CommitmentSignal => ({
    score           : value !== null ? Math.round(value) : null,
    effectiveWeight,
    baseWeight,
    available       : value !== null,
  });

  return {
    score    : finalScore,
    label    : labelFromScore(finalScore),
    isUnrated: false,

    signals: {
      completion : makeSignal(completionScore, BASE_WEIGHTS.completion, effectiveWeights[0]),
      onTime     : makeSignal(onTimeScore,     BASE_WEIGHTS.onTime,     effectiveWeights[1]),
      revision   : makeSignal(revisionScore,   BASE_WEIGHTS.revision,   effectiveWeights[2]),
      rating     : makeSignal(ratingScore,     BASE_WEIGHTS.rating,     effectiveWeights[3]),
    },

    totalConcluded,
    completed,
    cancelledByWorker,
    cancellationRate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch helper (for admin table — pass in the Map from getMultipleWorkerStats)
// ─────────────────────────────────────────────────────────────────────────────

export function computeMultipleCommitmentIndexes(
  statsMap: Map<string, WorkerAssignmentStats>
): Map<string, CommitmentIndex> {
  const result = new Map<string, CommitmentIndex>();
  for (const [userId, stats] of statsMap) {
    result.set(userId, computeCommitmentIndex(stats));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers (used directly in components — no extra mapping needed)
// ─────────────────────────────────────────────────────────────────────────────

/** Tailwind-compatible color tokens per label for badges and score rings */
export const COMMITMENT_COLORS: Record<
  CommitmentLabel,
  { bg: string; text: string; border: string; hex: string }
> = {
  Exceptional : { bg: "bg-green-100",  text: "text-green-800",  border: "border-green-300", hex: "#3B6D11" },
  Reliable    : { bg: "bg-blue-100",   text: "text-blue-800",   border: "border-blue-300",  hex: "#185FA5" },
  Developing  : { bg: "bg-amber-100",  text: "text-amber-800",  border: "border-amber-300", hex: "#854F0B" },
  "At Risk"   : { bg: "bg-red-100",    text: "text-red-800",    border: "border-red-300",   hex: "#A32D2D" },
  Unrated     : { bg: "bg-gray-100",   text: "text-gray-600",   border: "border-gray-300",  hex: "#5F5E5A" },
};

/** Short human-readable description shown under the score */
export const COMMITMENT_DESCRIPTIONS: Record<CommitmentLabel, string> = {
  Exceptional : "Consistently delivers on time with minimal revisions.",
  Reliable    : "Solid track record. Dependable for most projects.",
  Developing  : "Showing progress but some inconsistencies.",
  "At Risk"   : "High cancellation or revision rate. Monitor closely.",
  Unrated     : "Not enough project history to score yet.",
};

/** Signal display labels used in the breakdown panel */
export const SIGNAL_LABELS = {
  completion : "Completion rate",
  onTime     : "On-time delivery",
  revision   : "Low revision rate",
  rating     : "BD rating",
} as const;