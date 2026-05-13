// lib/worker-stats/assignments.ts
//
// Worker performance data layer.
// Provides raw stats used by the Commitment Index scorer and performance pages.
//
// Two exports:
//   getWorkerAssignmentStats(userId)        → single worker, full detail
//   getMultipleWorkerStats(userIds)         → batch, returns Map<userId, stats>
//                                             (used by admin performance table)

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
  // Cancellation rate counts only worker-caused cancellations, not manager removals.
  cancellationRate: number;  // cancelledByWorker / totalConcluded
  completionRate: number;    // completed / totalConcluded

  // ── On-time delivery ──────────────────────────────────────────────────────
  // Only counts completed projects where deadlineHours > 0 (deadline was actually set).
  // "On time" = timerAccumulatedSeconds ≤ deadlineHours × 3600
  onTimeEligible: number;    // completed projects with a deadline set
  onTimeCount: number;       // of those, how many were delivered within deadline
  onTimeRate: number;        // onTimeCount / onTimeEligible (0 if no eligible projects)

  // ── Revision rate ─────────────────────────────────────────────────────────
  // Counts how many of the worker's completed projects had at least one revision request.
  // A project with 3 revision cycles still counts as 1 (revised vs not revised).
  revisionCount: number;     // completed projects that had ≥1 REVISION_REQUEST message
  revisionRate: number;      // revisionCount / completed (0 if no completed projects)

  // ── BD ratings ────────────────────────────────────────────────────────────
  // Averaged across all rated completed projects the worker was assigned to.
  ratingCount: number;
  avgQuality: number | null;
  avgSpeed: number | null;
  avgCommunication: number | null;
  avgRating: number | null;  // mean of quality + speed + communication
};

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE WORKER
// ─────────────────────────────────────────────────────────────────────────────

export async function getWorkerAssignmentStats(
  userId: string
): Promise<WorkerAssignmentStats> {
  const prisma = getPrisma();

  // 1) All concluded assignments with project deadline data
  const concluded = await prisma.projectAssignment.findMany({
    where: {
      userId,
      outcome: { in: ["COMPLETED", "CANCELLED", "REMOVED"] },
    },
    select: {
      outcome: true,
      projectId: true,
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

  // ── On-time delivery ────────────────────────────────────────────────────
  const completedRows = concluded.filter((a) => a.outcome === "COMPLETED");
  const completedProjectIds = completedRows.map((a) => a.projectId);

  const onTimeEligible = completedRows.filter(
    (a) => (a.project.deadlineHours ?? 0) > 0
  ).length;

  const onTimeCount = completedRows.filter(
    (a) =>
      (a.project.deadlineHours ?? 0) > 0 &&
      a.project.timerAccumulatedSeconds <= (a.project.deadlineHours ?? 0) * 3600
  ).length;

  // ── Revision rate ───────────────────────────────────────────────────────
  let revisionCount = 0;
  if (completedProjectIds.length > 0) {
    // Count distinct projects that had at least one REVISION_REQUEST message
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
      avgQuality      = ratings.reduce((s, r) => s + r.quality, 0)       / ratingCount;
      avgSpeed        = ratings.reduce((s, r) => s + r.speed, 0)         / ratingCount;
      avgCommunication = ratings.reduce((s, r) => s + r.communication, 0) / ratingCount;
      avgRating       = (avgQuality + avgSpeed + avgCommunication) / 3;
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
    onTimeRate : onTimeEligible > 0 ? onTimeCount / onTimeEligible : 0,
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

  // Map projectId → rating for fast lookup
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

    const completedRows     = userRows.filter((a) => a.outcome === "COMPLETED");
    const onTimeEligible    = completedRows.filter((a) => (a.project.deadlineHours ?? 0) > 0).length;
    const onTimeCount       = completedRows.filter(
      (a) =>
        (a.project.deadlineHours ?? 0) > 0 &&
        a.project.timerAccumulatedSeconds <= (a.project.deadlineHours ?? 0) * 3600
    ).length;

    const completedIds      = completedByUser.get(userId) ?? [];
    const revisionCount     = completedIds.filter((id) => revisedProjectIds.has(id)).length;

    // Ratings for this user's completed projects
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
      onTimeRate : onTimeEligible > 0 ? onTimeCount / onTimeEligible : 0,
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