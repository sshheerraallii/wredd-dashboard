// lib/worker-stats/assignments.ts
//
// Worker performance data layer.
// Provides raw stats used by the Commitment Index scorer and performance pages.
//
// Two exports:
//   getWorkerAssignmentStats(userId)        → single worker, full detail
//   getMultipleWorkerStats(userIds)         → batch, returns Map<userId, stats>
//                                             (used by admin performance table)
//
// ON-TIME SCORING (v2 — gradient, not binary)
// ─────────────────────────────────────────────
// Each eligible assignment gets a 0–100 score based on how late delivery was
// as a ratio of the project deadline. avgOnTimeScore is the mean across all
// eligible assignments.
//
// hoursLate source (per assignment):
//   1. assignment.hoursLate set by manager at completion → use directly
//   2. null (auto) → max(0, timerAccumulatedSeconds / 3600 - deadlineHours)
//
// latenessRatio = hoursLate / deadlineHours
//   0%        → 100 (on time)
//   ≤10%      →  80 (minor)
//   ≤25%      →  60 (moderate)
//   ≤50%      →  30 (significant)
//   >50%      →   0 (severe)

import { getPrisma } from "@/lib/prisma";

export type WorkerAssignmentStats = {
  userId: string;

  // ── Raw counts ────────────────────────────────────────────────────────────
  active: number;            // currently assigned (outcome=ACTIVE, unassignedAt=null)
  completed: number;         // outcome = COMPLETED
  cancelledByWorker: number; // outcome = CANCELLED  (worker ghosted / quit)
  removedByManager: number;  // outcome = REMOVED    (manager removed, not worker's fault)
  totalConcluded: number;    // completed + cancelledByWorker + removedByManager

  // ── Rates (0–1) ───────────────────────────────────────────────────────────
  cancellationRate: number;  // cancelledByWorker / totalConcluded
  completionRate: number;    // completed / totalConcluded

  // ── On-time delivery (v2 — gradient) ──────────────────────────────────────
  onTimeEligible: number;        // completed assignments with deadlineHours > 0
  onTimeCount: number;           // of those, how many had hoursLate === 0 (perfectly on time)
  onTimeRate: number;            // onTimeCount / onTimeEligible (kept for display)
  avgOnTimeScore: number | null; // 0–100 gradient average; null if no eligible assignments

  // ── Revision rate ─────────────────────────────────────────────────────────
  revisionCount: number;     // completed projects that had ≥1 REVISION_REQUEST message
  revisionRate: number;      // revisionCount / completed (0 if no completed projects)

  // ── BD ratings ────────────────────────────────────────────────────────────
  ratingCount: number;
  avgQuality: number | null;
  avgSpeed: number | null;
  avgCommunication: number | null;
  avgRating: number | null;  // mean of quality + speed + communication
};

// ─────────────────────────────────────────────────────────────────────────────
// Gradient scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves how many hours late a worker was for one assignment.
 * Prefers manager-set hoursLate; falls back to auto-calc from project timer.
 */
function resolveHoursLate(
  assignmentHoursLate: number | null,
  timerAccumulatedSeconds: number,
  deadlineHours: number
): number {
  if (assignmentHoursLate !== null) return Math.max(0, assignmentHoursLate);
  const actualHours = timerAccumulatedSeconds / 3600;
  return Math.max(0, actualHours - deadlineHours);
}

/**
 * Maps lateness ratio (hoursLate / deadlineHours) to a 0–100 on-time score.
 * Bracket-based so thresholds are easy to understand and reason about.
 */
function latenessRatioToScore(hoursLate: number, deadlineHours: number): number {
  if (deadlineHours <= 0) return 100;
  const ratio = hoursLate / deadlineHours;
  if (ratio <= 0)    return 100;
  if (ratio <= 0.10) return 80;
  if (ratio <= 0.25) return 60;
  if (ratio <= 0.50) return 30;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE WORKER
// ─────────────────────────────────────────────────────────────────────────────

export async function getWorkerAssignmentStats(
  userId: string
): Promise<WorkerAssignmentStats> {
  const prisma = getPrisma();

  // 1) All concluded assignments with project deadline data + hoursLate
  const concluded = await prisma.projectAssignment.findMany({
    where: {
      userId,
      outcome: { in: ["COMPLETED", "CANCELLED", "REMOVED"] },
    },
    select: {
      outcome: true,
      projectId: true,
      hoursLate: true,
      project: {
        select: {
          deadlineHours: true,
          timerAccumulatedSeconds: true,
        },
      },
    },
  });

  // 2) Active count (currently working)
  const active = await prisma.projectAssignment.count({
    where: {
      userId,
      unassignedAt: null,
      outcome: "ACTIVE",
    },
  });

  // ── Raw counts ──────────────────────────────────────────────────────────
  const completed         = concluded.filter((a) => a.outcome === "COMPLETED").length;
  const cancelledByWorker = concluded.filter((a) => a.outcome === "CANCELLED").length;
  const removedByManager  = concluded.filter((a) => a.outcome === "REMOVED").length;
  const totalConcluded    = completed + cancelledByWorker + removedByManager;

  // ── On-time delivery (gradient) ─────────────────────────────────────────
  const completedRows = concluded.filter((a) => a.outcome === "COMPLETED");
  const completedProjectIds = completedRows.map((a) => a.projectId);

  const eligibleRows = completedRows.filter(
    (a) => (a.project.deadlineHours ?? 0) > 0
  );
  const onTimeEligible = eligibleRows.length;

  let onTimeCount = 0;
  let avgOnTimeScore: number | null = null;

  if (onTimeEligible > 0) {
    const scores = eligibleRows.map((a) => {
      const deadlineHours = a.project.deadlineHours ?? 0;
      const hoursLate = resolveHoursLate(
        a.hoursLate,
        a.project.timerAccumulatedSeconds,
        deadlineHours
      );
      if (hoursLate === 0) onTimeCount++;
      return latenessRatioToScore(hoursLate, deadlineHours);
    });
    avgOnTimeScore = scores.reduce((s, v) => s + v, 0) / scores.length;
  }

  // ── Revision rate ───────────────────────────────────────────────────────
  let revisionCount = 0;
  if (completedProjectIds.length > 0) {
    const revisedGroups = await prisma.projectMessage.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: completedProjectIds },
        type: "REVISION_REQUEST",
      },
    });
    revisionCount = revisedGroups.length;
  }

  // ── BD ratings ──────────────────────────────────────────────────────────
  let avgQuality: number | null = null;
  let avgSpeed: number | null = null;
  let avgCommunication: number | null = null;
  let avgRating: number | null = null;
  let ratingCount = 0;

  if (completedProjectIds.length > 0) {
    const ratings = await prisma.projectRating.findMany({
      where: { projectId: { in: completedProjectIds } },
      select: { quality: true, speed: true, communication: true },
    });

    ratingCount = ratings.length;

    if (ratingCount > 0) {
      avgQuality       = ratings.reduce((s, r) => s + r.quality, 0)       / ratingCount;
      avgSpeed         = ratings.reduce((s, r) => s + r.speed, 0)         / ratingCount;
      avgCommunication = ratings.reduce((s, r) => s + r.communication, 0) / ratingCount;
      avgRating        = (avgQuality + avgSpeed + avgCommunication) / 3;
    }
  }

  return {
    userId,
    active,
    completed,
    cancelledByWorker,
    removedByManager,
    totalConcluded,
    cancellationRate : totalConcluded > 0 ? cancelledByWorker / totalConcluded : 0,
    completionRate   : totalConcluded > 0 ? completed         / totalConcluded : 0,
    onTimeEligible,
    onTimeCount,
    onTimeRate   : onTimeEligible > 0 ? onTimeCount / onTimeEligible : 0,
    avgOnTimeScore,
    revisionCount,
    revisionRate : completed > 0 ? revisionCount / completed : 0,
    ratingCount,
    avgQuality,
    avgSpeed,
    avgCommunication,
    avgRating,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH (admin performance table — avoids N+1 queries)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMultipleWorkerStats(
  userIds: string[]
): Promise<Map<string, WorkerAssignmentStats>> {
  if (userIds.length === 0) return new Map();

  const prisma = getPrisma();

  // 1) All concluded assignments for all workers in one query
  const allConcluded = await prisma.projectAssignment.findMany({
    where: {
      userId: { in: userIds },
      outcome: { in: ["COMPLETED", "CANCELLED", "REMOVED"] },
    },
    select: {
      userId: true,
      outcome: true,
      projectId: true,
      hoursLate: true,
      project: {
        select: {
          deadlineHours: true,
          timerAccumulatedSeconds: true,
        },
      },
    },
  });

  // 2) Active counts per worker in one query
  const allActive = await prisma.projectAssignment.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      unassignedAt: null,
      outcome: "ACTIVE",
    },
    _count: { _all: true },
  });
  const activeByUser = new Map(allActive.map((r) => [r.userId, r._count._all]));

  // 3) Collect all completed projectIds per user for bulk sub-queries
  const completedByUser = new Map<string, string[]>();
  for (const a of allConcluded) {
    if (a.outcome === "COMPLETED") {
      if (!completedByUser.has(a.userId)) completedByUser.set(a.userId, []);
      completedByUser.get(a.userId)!.push(a.projectId);
    }
  }
  const allCompletedProjectIds = [...new Set(allConcluded
    .filter((a) => a.outcome === "COMPLETED")
    .map((a) => a.projectId))];

  // 4) Revision counts — one bulk query, grouped by projectId
  const revisionGroups =
    allCompletedProjectIds.length > 0
      ? await prisma.projectMessage.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: allCompletedProjectIds },
            type: "REVISION_REQUEST",
          },
        })
      : [];
  const revisedProjectIds = new Set(revisionGroups.map((r) => r.projectId));

  // 5) BD ratings — one bulk query
  const allRatings =
    allCompletedProjectIds.length > 0
      ? await prisma.projectRating.findMany({
          where: { projectId: { in: allCompletedProjectIds } },
          select: { projectId: true, quality: true, speed: true, communication: true },
        })
      : [];

  const ratingByProject = new Map(allRatings.map((r) => [r.projectId, r]));

  // ── Assemble per-user stats ─────────────────────────────────────────────
  const result = new Map<string, WorkerAssignmentStats>();

  for (const userId of userIds) {
    const userRows = allConcluded.filter((a) => a.userId === userId);

    const completed         = userRows.filter((a) => a.outcome === "COMPLETED").length;
    const cancelledByWorker = userRows.filter((a) => a.outcome === "CANCELLED").length;
    const removedByManager  = userRows.filter((a) => a.outcome === "REMOVED").length;
    const totalConcluded    = completed + cancelledByWorker + removedByManager;
    const active            = activeByUser.get(userId) ?? 0;

    const completedRows  = userRows.filter((a) => a.outcome === "COMPLETED");
    const eligibleRows   = completedRows.filter((a) => (a.project.deadlineHours ?? 0) > 0);
    const onTimeEligible = eligibleRows.length;

    let onTimeCount = 0;
    let avgOnTimeScore: number | null = null;

    if (onTimeEligible > 0) {
      const scores = eligibleRows.map((a) => {
        const deadlineHours = a.project.deadlineHours ?? 0;
        const hoursLate = resolveHoursLate(
          a.hoursLate,
          a.project.timerAccumulatedSeconds,
          deadlineHours
        );
        if (hoursLate === 0) onTimeCount++;
        return latenessRatioToScore(hoursLate, deadlineHours);
      });
      avgOnTimeScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    }

    const completedIds  = completedByUser.get(userId) ?? [];
    const revisionCount = completedIds.filter((id) => revisedProjectIds.has(id)).length;

    const userRatings = completedIds
      .map((id) => ratingByProject.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);

    const ratingCount = userRatings.length;
    let avgQuality: number | null = null;
    let avgSpeed: number | null = null;
    let avgCommunication: number | null = null;
    let avgRating: number | null = null;

    if (ratingCount > 0) {
      avgQuality       = userRatings.reduce((s, r) => s + r.quality, 0)       / ratingCount;
      avgSpeed         = userRatings.reduce((s, r) => s + r.speed, 0)         / ratingCount;
      avgCommunication = userRatings.reduce((s, r) => s + r.communication, 0) / ratingCount;
      avgRating        = (avgQuality + avgSpeed + avgCommunication) / 3;
    }

    result.set(userId, {
      userId,
      active,
      completed,
      cancelledByWorker,
      removedByManager,
      totalConcluded,
      cancellationRate : totalConcluded > 0 ? cancelledByWorker / totalConcluded : 0,
      completionRate   : totalConcluded > 0 ? completed         / totalConcluded : 0,
      onTimeEligible,
      onTimeCount,
      onTimeRate   : onTimeEligible > 0 ? onTimeCount / onTimeEligible : 0,
      avgOnTimeScore,
      revisionCount,
      revisionRate : completed > 0 ? revisionCount / completed : 0,
      ratingCount,
      avgQuality,
      avgSpeed,
      avgCommunication,
      avgRating,
    });
  }

  return result;
}