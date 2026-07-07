import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Prorated monthly onsite target + the WREDD working-day calendar.
 *
 * WREDD works Mon–Sat; Sunday is the only company-wide off day. Each worker
 * additionally takes ~1 personal off day a month, which is why the configured
 * `workingDays` for a normal month is 25 (≈26 Mon–Sat days − 1 personal day),
 * NOT 26. That personal day is already baked into the divisor, so it must not
 * be subtracted again from the elapsed-days numerator.
 *
 * Source of truth for the divisor is MonthlyFinanceConfig.workingDays
 * (hand-entered per month); DEFAULT_WORKING_DAYS is the fallback when a month
 * has no configured value.
 *
 * This module replaces per-page copies of `countWorkingDays` /
 * `proratedMonthlyTarget` that previously (a) counted Mon–Fri only, silently
 * dropping every Saturday, and (b) divided by a hardcoded 25 instead of the
 * configured value. Both bugs inflated accuracy mid-month.
 */

export const DEFAULT_WORKING_DAYS = 25;

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthRangeFromKey(key: string): { start: Date; end: Date } {
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const m = Number(ms) - 1;
  // end is the exclusive first-of-next-month boundary (matches prior pages).
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Count WREDD working days (Mon–Sat, Sunday excluded) between two dates,
 * both inclusive. Local time, matching the existing performance pages.
 */
export function countWorkingDays(from: Date, to: Date): number {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 0) count++; // 0 = Sunday
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export type ProratedTargetParams = {
  targetMonthlyPoints: number;
  joinedAt: Date;
  monthKey: string;
  /** Configured working days for this month; falls back to DEFAULT when absent. */
  workingDays?: number | null;
  /** Injectable for tests; defaults to the current time. */
  now?: Date;
};

/**
 * Prorated monthly target.
 *
 * - Current month: base × min(elapsed Mon–Sat days ÷ workingDays, 1).
 *   Capped at 1.0 so a fully-elapsed month lands at exactly the full target —
 *   ≈26 Mon–Sat days over a 25-day divisor would otherwise read as >100%.
 * - Past months: calendar-day proration (only matters for a mid-month joiner;
 *   a fully-worked month returns the full target). Unchanged from prior logic.
 * - Join guard: returns 0 if the worker joined after the month ends, or after
 *   today within the current month.
 */
export function proratedMonthlyTarget(params: ProratedTargetParams): number {
  const base = params.targetMonthlyPoints ?? 0;
  if (base <= 0) return 0;

  const wd =
    params.workingDays && params.workingDays > 0
      ? params.workingDays
      : DEFAULT_WORKING_DAYS;

  const { start, end } = monthRangeFromKey(params.monthKey);
  const now = params.now ?? new Date();
  const isCurrentMonth = params.monthKey === monthKeyOf(now);

  const joinDay = startOfDay(params.joinedAt);
  if (joinDay >= end) return 0; // joined after this month entirely

  const effectiveStart = joinDay > start ? joinDay : start;

  if (isCurrentMonth) {
    const todayStart = startOfDay(now);
    if (todayStart < effectiveStart) return 0; // joined after today
    const elapsed = countWorkingDays(effectiveStart, todayStart);
    if (elapsed === 0) return 0; // first day of the month and it's a Sunday
    const frac = Math.min(elapsed / wd, 1);
    return base * frac;
  }

  // Past month — calendar-day proration (unchanged; only differs for a
  // worker who joined mid-month).
  if (joinDay <= start) return base;
  const totalDays = daysInMonth(start);
  const dayIndex = joinDay.getDate();
  const remainingDaysInclusive = totalDays - dayIndex + 1;
  return base * (remainingDaysInclusive / totalDays);
}

/**
 * All configured working days, keyed by monthKey. Only positive configured
 * values are included; callers fall back to DEFAULT_WORKING_DAYS for any month
 * absent from the map. Bounded (one row per configured month), so this is a
 * single cheap query suitable for an internal, force-dynamic tool.
 */
export async function getAllWorkingDaysMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const rows = await prisma.monthlyFinanceConfig.findMany({
    select: { monthKey: true, workingDays: true },
  });
  for (const r of rows) {
    if (r.workingDays && r.workingDays > 0) map.set(r.monthKey, r.workingDays);
  }
  return map;
}
