import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

/**
 * Effective-dated history for a worker's onsite hour rate and monthly target.
 *
 * Why this exists: BD commission overhead is computed from
 * `allocatedHours x onsiteHourRatePkr`, and monthly accuracy is computed from
 * `targetMonthlyPoints`. Both used to be read from the CURRENT value on User,
 * so raising someone's salary in September silently rewrote July and August the
 * next time a month was recalculated.
 *
 * Each UserRateHistory row is a COMPLETE snapshot of both values as of
 * `effectiveFrom` (UTC midnight, inclusive). Resolution for a date takes the
 * latest row at or before that date. If no row exists — e.g. before the
 * backfill has run — we fall back to the current values on User, so nothing
 * breaks.
 *
 * Convention: `effectiveFrom` defaults to the FIRST OF THE MONTH in which the
 * change is made, because salaries, targets and commissions are all monthly.
 * A mid-month date is allowed (backdated corrections, forward-dated raises) but
 * will split that month across two rates.
 */

export type ResolvedUserRates = {
  onsiteHourRatePkr: number | null;
  targetMonthlyPoints: number;
  /** effectiveFrom of the row used, or null when falling back to User. */
  source: Date | null;
};

type Db = Prisma.TransactionClient;

function db(client?: Db): Db {
  return client ?? (getPrisma() as unknown as Db);
}

/** UTC midnight on the 1st of the month containing `d`. */
export function firstOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** UTC midnight for a yyyy-mm-dd string. Returns null if unparseable. */
export function parseEffectiveFrom(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Rates for one user as of a point in time.
 */
export async function resolveUserRatesAsOf(
  userId: string,
  at: Date,
  client?: Db
): Promise<ResolvedUserRates> {
  const map = await resolveManyUserRatesAsOf([userId], at, client);
  return (
    map.get(userId) ?? {
      onsiteHourRatePkr: null,
      targetMonthlyPoints: 0,
      source: null,
    }
  );
}

/**
 * Rates for several users as of a point in time, in two queries rather than
 * one per user. Falls back to the current User values for anyone with no
 * history row at or before `at`.
 */
export async function resolveManyUserRatesAsOf(
  userIds: string[],
  at: Date,
  client?: Db
): Promise<Map<string, ResolvedUserRates>> {
  const out = new Map<string, ResolvedUserRates>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const c = db(client);

  const rows = await c.userRateHistory.findMany({
    where: { userId: { in: ids }, effectiveFrom: { lte: at } },
    orderBy: [{ userId: "asc" }, { effectiveFrom: "desc" }],
    select: {
      userId: true,
      effectiveFrom: true,
      onsiteHourRatePkr: true,
      targetMonthlyPoints: true,
    },
  });

  // rows are sorted newest-first within each user, so the first wins.
  for (const r of rows) {
    if (out.has(r.userId)) continue;
    out.set(r.userId, {
      onsiteHourRatePkr: r.onsiteHourRatePkr ?? null,
      targetMonthlyPoints: r.targetMonthlyPoints ?? 0,
      source: r.effectiveFrom,
    });
  }

  const missing = ids.filter((id) => !out.has(id));
  if (missing.length > 0) {
    const users = await c.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, onsiteHourRatePkr: true, targetMonthlyPoints: true },
    });
    for (const u of users) {
      out.set(u.id, {
        onsiteHourRatePkr: u.onsiteHourRatePkr ?? null,
        targetMonthlyPoints: u.targetMonthlyPoints ?? 0,
        source: null,
      });
    }
  }

  return out;
}

/**
 * Record a rate/target change, then re-sync the denormalised current values on
 * User from whichever history row is latest.
 *
 * Upserts on (userId, effectiveFrom): correcting a typo on the same effective
 * date replaces the row instead of stacking a second one.
 *
 * Backdating is supported — the User row keeps the value from the newest
 * effectiveFrom, not from whichever row was written last.
 */
export async function recordUserRateChange(
  input: {
    userId: string;
    effectiveFrom: Date;
    onsiteHourRatePkr: number | null;
    targetMonthlyPoints: number;
    note?: string | null;
    createdById?: string | null;
  },
  client?: Db
): Promise<void> {
  const c = db(client);

  await c.userRateHistory.upsert({
    where: {
      userId_effectiveFrom: {
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
      },
    },
    create: {
      userId: input.userId,
      effectiveFrom: input.effectiveFrom,
      onsiteHourRatePkr: input.onsiteHourRatePkr,
      targetMonthlyPoints: input.targetMonthlyPoints,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
    update: {
      onsiteHourRatePkr: input.onsiteHourRatePkr,
      targetMonthlyPoints: input.targetMonthlyPoints,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });

  const latest = await c.userRateHistory.findFirst({
    where: { userId: input.userId },
    orderBy: { effectiveFrom: "desc" },
    select: { onsiteHourRatePkr: true, targetMonthlyPoints: true },
  });

  if (latest) {
    await c.user.update({
      where: { id: input.userId },
      data: {
        onsiteHourRatePkr: latest.onsiteHourRatePkr,
        targetMonthlyPoints: latest.targetMonthlyPoints ?? 0,
      },
    });
  }
}

/** Full history for one user, newest first. For display. */
export async function listUserRateHistory(userId: string, client?: Db) {
  return db(client).userRateHistory.findMany({
    where: { userId },
    orderBy: { effectiveFrom: "desc" },
    select: {
      id: true,
      effectiveFrom: true,
      onsiteHourRatePkr: true,
      targetMonthlyPoints: true,
      note: true,
      createdAt: true,
    },
  });
}
