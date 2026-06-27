import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Manual performance points — ± adjustments with a required note, added by
 * Manager / Super Admin. FINALIZED-only: they fold into the achieved points
 * total (and therefore accuracy), attributed to the month they were given.
 */

/** Sum of manual points for a user, optionally scoped to a single month. */
export async function sumManualForUser(
  userId: string,
  opts?: { monthKey?: string }
): Promise<number> {
  const agg = await prisma.manualPerformancePoint.aggregate({
    where: { userId, ...(opts?.monthKey ? { monthKey: opts.monthKey } : {}) },
    _sum: { points: true },
  });
  return agg._sum.points ?? 0;
}

/** Manual totals grouped by month for a user, limited to the given months. */
export async function sumManualByMonth(
  userId: string,
  monthKeys: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (monthKeys.length === 0) return out;

  const rows = await prisma.manualPerformancePoint.groupBy({
    by: ["monthKey"],
    where: { userId, monthKey: { in: monthKeys } },
    _sum: { points: true },
  });

  for (const r of rows) out.set(r.monthKey, r._sum.points ?? 0);
  return out;
}

export type ManualEntry = {
  id: string;
  points: number;
  note: string;
  monthKey: string;
  createdAt: Date;
  createdByName: string | null;
};

/** Audit list of manual entries for a user, newest first, optionally by month. */
export async function listManualForUser(
  userId: string,
  opts?: { monthKey?: string }
): Promise<ManualEntry[]> {
  const rows = await prisma.manualPerformancePoint.findMany({
    where: { userId, ...(opts?.monthKey ? { monthKey: opts.monthKey } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      points: true,
      note: true,
      monthKey: true,
      createdAt: true,
      createdBy: { select: { fullName: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    points: r.points,
    note: r.note,
    monthKey: r.monthKey,
    createdAt: r.createdAt,
    createdByName: r.createdBy?.fullName ?? null,
  }));
}
