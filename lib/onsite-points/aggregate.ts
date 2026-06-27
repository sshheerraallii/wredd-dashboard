import { getPrisma } from "@/lib/prisma";
import { getOnsiteConstants } from "./settings";
import {
  estimatePoints,
  resolveEverDelivered,
  effectiveConstants,
  type ProjectStatus,
} from "./estimate";

const prisma = getPrisma();

// Projects in these states contribute to the ESTIMATED layer. COMPLETED is
// finalized (counted elsewhere), CANCELLED/UNASSIGNED contribute nothing.
const ESTIMATE_STATES: ProjectStatus[] = ["IN_PROGRESS", "DELIVERED", "REVISION"];

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number((v as any).toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export function currentMonthKeyUTC(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Exact month's FX, else most recent prior month with a positive FX, else 0. */
export async function resolveFx(monthKey: string): Promise<number> {
  const exact = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { fxRate: true },
  });
  if (exact && num(exact.fxRate) > 0) return num(exact.fxRate);

  const prior = await prisma.monthlyFinanceConfig.findFirst({
    where: { monthKey: { lt: monthKey }, fxRate: { gt: 0 } },
    orderBy: { monthKey: "desc" },
    select: { fxRate: true },
  });
  if (prior) return num(prior.fxRate);

  return 0;
}

export type EstimatedLine = {
  projectId: string;
  title: string;
  status: ProjectStatus;
  allocatedHours: number | null;
  basePoints: number;
  estimatedPoints: number;
  stateFactor: number;
  computable: boolean;
};

export type UserEstimatedSummary = {
  userId: string;
  lines: EstimatedLine[];
  totalEstimatedPoints: number;
  fxRate: number;
  fxMissing: boolean;
};

/**
 * Compute the ESTIMATED points layer for one or many onsite users.
 *
 * One pass: pull every active, non-cancelled assignment on an estimate-eligible
 * project for the given users, plus each user's hourly rate, then run the pure
 * engine per assignment. Snapshot constants win; otherwise current globals.
 */
export async function getEstimatedForUsers(
  userIds: string[],
  opts?: { monthKey?: string; now?: Date }
): Promise<Map<string, UserEstimatedSummary>> {
  const now = opts?.now ?? new Date();
  const monthKey = opts?.monthKey ?? currentMonthKeyUTC(now);

  const result = new Map<string, UserEstimatedSummary>();
  if (userIds.length === 0) return result;

  const [globals, fxRate] = await Promise.all([
    getOnsiteConstants(),
    resolveFx(monthKey),
  ]);
  const fxMissing = fxRate <= 0;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, onsiteHourRatePkr: true },
  });
  const rateById = new Map(users.map((u) => [u.id, u.onsiteHourRatePkr ?? null]));

  // Seed empty summaries so every requested user is present in the result.
  for (const id of userIds) {
    result.set(id, {
      userId: id,
      lines: [],
      totalEstimatedPoints: 0,
      fxRate,
      fxMissing,
    });
  }

  const assignments = await prisma.projectAssignment.findMany({
    where: {
      userId: { in: userIds },
      unassignedAt: null,
      outcome: { not: "CANCELLED" as any },
      project: { status: { in: ESTIMATE_STATES as any } },
    },
    select: {
      userId: true,
      allocatedHours: true,
      prodMultipleSnapshot: true,
      dollarsPerPointSnapshot: true,
      project: {
        select: {
          id: true,
          title: true,
          status: true,
          firstDeliveredAt: true,
          firstCompletedAt: true,
        },
      },
    },
  });

  for (const a of assignments) {
    const summary = result.get(a.userId);
    if (!summary) continue;

    const status = a.project.status as ProjectStatus;
    const everDelivered = resolveEverDelivered({
      firstDeliveredAt: a.project.firstDeliveredAt,
      firstCompletedAt: a.project.firstCompletedAt,
      status,
    });

    const consts = effectiveConstants(
      {
        prodMultipleSnapshot:
          a.prodMultipleSnapshot != null ? num(a.prodMultipleSnapshot) : null,
        dollarsPerPointSnapshot: a.dollarsPerPointSnapshot ?? null,
      },
      globals
    );

    const r = estimatePoints(
      {
        allocatedHours: a.allocatedHours,
        onsiteHourRatePkr: rateById.get(a.userId) ?? null,
        fxRate,
        productionMultiple: consts.productionMultiple,
        dollarsPerPoint: consts.dollarsPerPoint,
      },
      status,
      everDelivered
    );

    summary.lines.push({
      projectId: a.project.id,
      title: a.project.title,
      status,
      allocatedHours: a.allocatedHours,
      basePoints: r.basePoints,
      estimatedPoints: r.estimatedPoints,
      stateFactor: r.stateFactor,
      computable: r.computable,
    });
    summary.totalEstimatedPoints += r.estimatedPoints;
  }

  return result;
}

/** Convenience: estimated summary for a single user. */
export async function getUserEstimatedPoints(
  userId: string,
  opts?: { monthKey?: string; now?: Date }
): Promise<UserEstimatedSummary> {
  const map = await getEstimatedForUsers([userId], opts);
  return (
    map.get(userId) ?? {
      userId,
      lines: [],
      totalEstimatedPoints: 0,
      fxRate: 0,
      fxMissing: true,
    }
  );
}

export type ProjectEstimateLine = {
  userId: string;
  fullName: string;
  allocatedHours: number | null;
  basePoints: number;
  estimatedPoints: number;
  stateFactor: number;
  computable: boolean;
};

export type ProjectEstimate = {
  /** True when the project is in an estimate-eligible state. */
  eligible: boolean;
  status: ProjectStatus;
  lines: ProjectEstimateLine[];
  fxRate: number;
  fxMissing: boolean;
};

/**
 * Per-onsite-worker estimated points for a SINGLE project. Used on the project
 * page. Returns eligible=false (and no lines) once the project is finalized
 * (COMPLETED) or cancelled — at that point the project page shows the finalized
 * numbers instead.
 */
export async function getProjectEstimate(
  projectId: string,
  opts?: { monthKey?: string; now?: Date }
): Promise<ProjectEstimate> {
  const now = opts?.now ?? new Date();
  const monthKey = opts?.monthKey ?? currentMonthKeyUTC(now);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, firstDeliveredAt: true, firstCompletedAt: true },
  });

  if (!project) {
    return { eligible: false, status: "UNASSIGNED", lines: [], fxRate: 0, fxMissing: true };
  }

  const status = project.status as ProjectStatus;
  if (!ESTIMATE_STATES.includes(status)) {
    return { eligible: false, status, lines: [], fxRate: 0, fxMissing: true };
  }

  const [globals, fxRate] = await Promise.all([
    getOnsiteConstants(),
    resolveFx(monthKey),
  ]);
  const everDelivered = resolveEverDelivered({
    firstDeliveredAt: project.firstDeliveredAt,
    firstCompletedAt: project.firstCompletedAt,
    status,
  });

  const assignments = await prisma.projectAssignment.findMany({
    where: {
      projectId,
      unassignedAt: null,
      outcome: { not: "CANCELLED" as any },
    },
    select: {
      userId: true,
      allocatedHours: true,
      prodMultipleSnapshot: true,
      dollarsPerPointSnapshot: true,
      user: {
        select: { fullName: true, workerType: true, onsiteHourRatePkr: true },
      },
    },
  });

  const lines: ProjectEstimateLine[] = [];
  for (const a of assignments) {
    if (!String(a.user.workerType ?? "").startsWith("ONSITE_")) continue;

    const consts = effectiveConstants(
      {
        prodMultipleSnapshot:
          a.prodMultipleSnapshot != null ? num(a.prodMultipleSnapshot) : null,
        dollarsPerPointSnapshot: a.dollarsPerPointSnapshot ?? null,
      },
      globals
    );

    const r = estimatePoints(
      {
        allocatedHours: a.allocatedHours,
        onsiteHourRatePkr: a.user.onsiteHourRatePkr ?? null,
        fxRate,
        productionMultiple: consts.productionMultiple,
        dollarsPerPoint: consts.dollarsPerPoint,
      },
      status,
      everDelivered
    );

    lines.push({
      userId: a.userId,
      fullName: a.user.fullName,
      allocatedHours: a.allocatedHours,
      basePoints: r.basePoints,
      estimatedPoints: r.estimatedPoints,
      stateFactor: r.stateFactor,
      computable: r.computable,
    });
  }

  return { eligible: true, status, lines, fxRate, fxMissing: fxRate <= 0 };
}
