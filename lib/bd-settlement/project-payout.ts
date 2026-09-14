import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import {
  computeDepartmentCostBase,
  blendedHourCostPkr,
} from "./cost-base";

/**
 * "If the floor were 100% full, this project would pay you X."
 *
 *   contribution = netPkr - remotePayout - (hours x blendedHourCost)
 *   payout       = contribution x bdRate
 *
 * blendedHourCost is the whole studio cost divided by the whole studio
 * capacity, so at full utilisation the contributions of all projects sum to
 * (total revenue - total cost) = profit. The per-project figures therefore ADD
 * UP to the monthly settlement, which the old per-project estimate never did.
 *
 * The caveat that must always be shown alongside it: this holds ONLY at full
 * capacity. Unsold hours belong to no project, so at 28% utilisation every
 * project can look profitable while the month is a loss. It is a target, not a
 * forecast, and never the payable — the monthly settlement is the payable.
 */

type Db = Prisma.TransactionClient;

function db(client?: Db): Db {
  return client ?? (getPrisma() as unknown as Db);
}

export type FullCapacityContext = {
  monthKey: string;
  blendedRate: number;
  capacityHours: number;
  totalCostPkr: number;
};

export async function getFullCapacityContext(
  monthKey: string,
  client?: Db
): Promise<FullCapacityContext | null> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;
  try {
    const cb = await computeDepartmentCostBase(monthKey, client);
    const blendedRate = blendedHourCostPkr(cb);
    if (blendedRate <= 0) return null;
    return {
      monthKey,
      blendedRate,
      capacityHours: cb.totals.sellableHours,
      totalCostPkr: cb.totals.totalPkr,
    };
  } catch {
    return null;
  }
}

/** Onsite allocated hours per project, in one query. */
export async function getProjectHours(
  projectIds: string[],
  client?: Db
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(projectIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const rows = await db(client).projectAssignment.findMany({
    where: {
      projectId: { in: ids },
      unassignedAt: null,
      outcome: { not: "CANCELLED" as never },
      user: { role: "ONSITE_EMPLOYEE" as never },
    },
    select: { projectId: true, allocatedHours: true },
  });

  for (const r of rows) {
    out.set(r.projectId, (out.get(r.projectId) ?? 0) + (r.allocatedHours ?? 0));
  }
  return out;
}

export type ProjectFullCapacity = {
  hours: number;
  hourCostPkr: number;
  contributionPkr: number;
  payoutPkr: number;
};

export function projectAtFullCapacity(args: {
  netPkr: number;
  remotePayoutPkr?: number;
  hours: number;
  blendedRate: number;
  bdRate: number;
}): ProjectFullCapacity {
  const hourCost = Math.round(args.hours * args.blendedRate);
  const contribution = Math.round(
    args.netPkr - (args.remotePayoutPkr ?? 0) - hourCost
  );
  return {
    hours: args.hours,
    hourCostPkr: hourCost,
    contributionPkr: contribution,
    payoutPkr: Math.round(contribution * args.bdRate),
  };
}
