import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Date-range performance for onsite workers.
 *
 * Target uses each month's CONFIGURED working days (MonthlyFinanceConfig.workingDays,
 * fallback 25): for every month the range touches, the worker's monthly target is
 * scaled by (actual Mon–Sat days of that month inside the range ÷ that month's
 * configured working days), then summed. A range covering a full month therefore
 * contributes that month's full target.
 *
 * Achieved = project points (projects whose firstCompletedAt falls in the range)
 * + manual points (createdAt in the range).
 */

const DEFAULT_WORKING_DAYS = 25;

function monthKeyOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

/** Count WREDD working days (Mon–Sat, Sunday excluded) inclusive (UTC). */
function countWorkingDays(from: Date, to: Date): number {
  if (to < from) return 0;
  let count = 0;
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    if (cur.getUTCDay() !== 0) count++; // 0 = Sunday
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** List the month keys a [start, end] range touches. */
function monthKeysInRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  let cur = startOfMonthUTC(start);
  const last = startOfMonthUTC(end);
  while (cur <= last) {
    out.push(monthKeyOf(cur));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}

function targetForRange(
  monthlyTarget: number,
  start: Date,
  end: Date,
  cfgWorkingDays: Map<string, number>
): number {
  if (!monthlyTarget || monthlyTarget <= 0) return 0;

  let total = 0;
  let cur = startOfMonthUTC(start);
  const last = startOfMonthUTC(end);

  while (cur <= last) {
    const mKey = monthKeyOf(cur);
    const mStart = startOfMonthUTC(cur);
    const mEnd = endOfMonthUTC(cur);

    const ovStart = start > mStart ? start : mStart;
    const ovEnd = end < mEnd ? end : mEnd;

    const wd = countWorkingDays(ovStart, ovEnd);
    const cfgWD = cfgWorkingDays.get(mKey) ?? DEFAULT_WORKING_DAYS;
    // Cap at 1.0: a full month has ~26 Mon–Sat days over a ~25-day divisor,
    // which would otherwise contribute >100% of that month's target.
    if (cfgWD > 0) total += monthlyTarget * Math.min(wd / cfgWD, 1);

    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  return total;
}

export type DateRangeRow = {
  userId: string;
  fullName: string;
  projectPoints: number;
  manualPoints: number;
  achievedPoints: number;
  target: number;
  accuracy: number | null;
  workingDays: number;
};

export type ProjectBreakdownRow = {
  projectId: string;
  title: string;
  points: number;
  completedAt: Date | null;
};

/** Per-user date-range rows for a set of onsite users. */
export async function getDateRangePerformance(
  users: { id: string; fullName: string; targetMonthlyPoints: number }[],
  start: Date,
  end: Date
): Promise<DateRangeRow[]> {
  if (users.length === 0) return [];
  const userIds = users.map((u) => u.id);

  // Configured working days for each month the range spans.
  const mKeys = monthKeysInRange(start, end);
  const cfgs = await prisma.monthlyFinanceConfig.findMany({
    where: { monthKey: { in: mKeys } },
    select: { monthKey: true, workingDays: true },
  });
  const cfgMap = new Map<string, number>();
  for (const c of cfgs) {
    if (c.workingDays && c.workingDays > 0) cfgMap.set(c.monthKey, c.workingDays);
  }

  // Project points: credits whose project completed within the range.
  const credits = await prisma.onsitePointCredit.findMany({
    where: {
      userId: { in: userIds },
      project: { firstCompletedAt: { gte: start, lte: end } },
    },
    select: { userId: true, points: true },
  });
  const projectByUser = new Map<string, number>();
  for (const c of credits)
    projectByUser.set(c.userId, (projectByUser.get(c.userId) ?? 0) + c.points);

  // Manual points: entries created within the range.
  const manuals = await prisma.manualPerformancePoint.findMany({
    where: { userId: { in: userIds }, createdAt: { gte: start, lte: end } },
    select: { userId: true, points: true },
  });
  const manualByUser = new Map<string, number>();
  for (const m of manuals)
    manualByUser.set(m.userId, (manualByUser.get(m.userId) ?? 0) + m.points);

  return users.map((u) => {
    const projectPoints = projectByUser.get(u.id) ?? 0;
    const manualPoints = manualByUser.get(u.id) ?? 0;
    const achievedPoints = projectPoints + manualPoints;
    const target = targetForRange(u.targetMonthlyPoints, start, end, cfgMap);
    const accuracy = target > 0 ? Math.round((achievedPoints / target) * 100) : null;
    return {
      userId: u.id,
      fullName: u.fullName,
      projectPoints,
      manualPoints,
      achievedPoints,
      target: Math.round(target * 10) / 10,
      accuracy,
      workingDays: countWorkingDays(start, end),
    };
  });
}

/** Projects a single user completed within the range, with their credited points. */
export async function getDateRangeProjectBreakdown(
  userId: string,
  start: Date,
  end: Date
): Promise<ProjectBreakdownRow[]> {
  const credits = await prisma.onsitePointCredit.findMany({
    where: {
      userId,
      project: { firstCompletedAt: { gte: start, lte: end } },
    },
    select: {
      points: true,
      project: { select: { id: true, title: true, firstCompletedAt: true } },
    },
    orderBy: { project: { firstCompletedAt: "desc" } },
  });

  return credits.map((c) => ({
    projectId: c.project.id,
    title: c.project.title,
    points: c.points,
    completedAt: c.project.firstCompletedAt,
  }));
}
