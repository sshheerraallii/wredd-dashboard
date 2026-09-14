import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import {
  computeDepartmentCostBase,
  countWeekdays,
  monthBounds,
  type CostBaseResult,
} from "./cost-base";

/**
 * Monthly BD settlement — ABSORPTION COSTING.
 *
 *   revenue   = sum of netPkr on his projects first-completed this month
 *   - remote worker payouts        (variable, charged per job)
 *   - cost base                    (fixed, his share of the departments)
 *   = profit
 *   payout    = max(0, profit x bdRate)
 *
 * The cost base does NOT move with how busy the floor is. That is the whole
 * point: idle capacity charges itself to the BD who failed to fill it, with no
 * separate penalty rule to argue about.
 *
 * Deliberately NOT used here: BdCommission.overheadPkr. That per-project figure
 * is allocatedHours x the FULL worker rate, and the full rate already contains
 * the department overhead. Subtracting it here as well would charge the same
 * overhead twice. It stays on the project page for margin analysis only.
 *
 * Projects already marked PAID or EXCEPTION_PAID are excluded outright — their
 * payout stands as settled and never re-enters the monthly maths.
 */

type Db = Prisma.TransactionClient;

function db(client?: Db): Db {
  return client ?? (getPrisma() as unknown as Db);
}

export type BdSettlement = {
  bdId: string;
  bdName: string;
  bdRate: number;
  revenuePkr: number;
  remotePayoutPkr: number;
  costSalariesPkr: number;
  costOverheadPkr: number;
  /** Charged this month. Equals costBaseFullPkr once the month is over. */
  costBasePkr: number;
  /** The whole month's commitment, before mid-month proration. */
  costBaseFullPkr: number;
  profitPkr: number;
  payoutPkr: number;
  projectCount: number;
  excludedPaidCount: number;
  capacityHours: number;
  usedHours: number;
  allocations: { departmentId: string; name: string; sharePercent: number; chargedPkr: number }[];
};

export type SettlementRun = {
  monthKey: string;
  costBase: CostBaseResult;
  settlements: BdSettlement[];
  warnings: string[];
  /** Working days elapsed / in the month, and the resulting cost-base factor. */
  elapsedWorkDays: number;
  workDaysInMonth: number;
  prorationPct: number;
  isCurrentMonth: boolean;
};

function toNum(v: unknown): number {
  const n = Number((v as { toString?: () => string })?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute (but do not persist) settlements for a month.
 * Throws when allocations are missing — never silently inherits another month.
 */
export async function computeBdSettlements(
  monthKey: string,
  client?: Db
): Promise<SettlementRun> {
  const c = db(client);
  const warnings: string[] = [];

  const costBase = await computeDepartmentCostBase(monthKey, c);

  // Mid-month, revenue is partial but the cost base is a whole month. Comparing
  // the two makes every BD look deeply unprofitable on the 10th and teaches
  // people to ignore the page. So for the CURRENT month only, the cost base is
  // pro-rated by working days elapsed. Closed months always charge in full.
  const { start, end } = monthBounds(monthKey);
  const now = new Date();
  const isCurrentMonth = now >= start && now < end;
  const workDaysInMonth = countWeekdays(start, end) || 1;
  const elapsedWorkDays = isCurrentMonth
    ? countWeekdays(
        start,
        new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
        )
      )
    : workDaysInMonth;
  const proration = isCurrentMonth
    ? Math.min(1, elapsedWorkDays / workDaysInMonth)
    : 1;

  const allocations = await c.bdDepartmentAllocation.findMany({
    where: { monthKey },
    select: {
      bdId: true,
      departmentId: true,
      sharePercent: true,
      bd: { select: { fullName: true, bdCommissionRate: true } },
      department: { select: { name: true } },
    },
  });

  if (allocations.length === 0) {
    throw new Error(
      `No BdDepartmentAllocation rows for ${monthKey}. Set department shares for this month before settling — they decide who carries which department's cost.`
    );
  }

  // Every department's shares must total 100, or cost silently goes unclaimed.
  const byDeptShare = new Map<string, number>();
  for (const a of allocations) {
    byDeptShare.set(
      a.departmentId,
      (byDeptShare.get(a.departmentId) ?? 0) + toNum(a.sharePercent)
    );
  }
  for (const d of costBase.departments) {
    const total = byDeptShare.get(d.departmentId) ?? 0;
    if (Math.abs(total - 100) > 0.01) {
      warnings.push(
        `${d.name}: department shares total ${total.toFixed(2)}%, not 100%. ${
          total < 100
            ? `${(100 - total).toFixed(2)}% of its cost is charged to nobody.`
            : `It is over-charged by ${(total - 100).toFixed(2)}%.`
        }`
      );
    }
  }

  if (costBase.poolPkr <= 0) {
    warnings.push(
      "Overhead pool for this month is 0. Set it in Finance Config or every BD's cost base is salaries only."
    );
  }

  for (const o of costBase.orphans) {
    warnings.push(
      `${o.fullName} is active this month but in no department — ${o.salaryPkr.toLocaleString()} PKR of salary is charged to nobody.`
    );
  }

  const deptById = new Map(costBase.departments.map((d) => [d.departmentId, d]));

  // Group allocations per BD.
  const bdMap = new Map<
    string,
    {
      bdName: string;
      bdRate: number;
      rows: { departmentId: string; name: string; sharePercent: number }[];
    }
  >();

  for (const a of allocations) {
    const cur = bdMap.get(a.bdId) ?? {
      bdName: a.bd.fullName,
      bdRate: toNum(a.bd.bdCommissionRate),
      rows: [],
    };
    cur.rows.push({
      departmentId: a.departmentId,
      name: a.department.name,
      sharePercent: toNum(a.sharePercent),
    });
    bdMap.set(a.bdId, cur);
  }

  const settlements: BdSettlement[] = [];

  for (const [bdId, bd] of bdMap.entries()) {
    let costSalaries = 0;
    let costOverhead = 0;
    let capacityHours = 0;
    const allocOut: BdSettlement["allocations"] = [];

    for (const r of bd.rows) {
      const d = deptById.get(r.departmentId);
      if (!d) continue;
      const share = r.sharePercent / 100;
      const sal = d.salariesPkr * share;
      const ovh = d.poolPkr * share;
      costSalaries += sal;
      costOverhead += ovh;
      capacityHours += d.sellableHours * share;
      allocOut.push({
        departmentId: r.departmentId,
        name: d.name,
        sharePercent: r.sharePercent,
        chargedPkr: Math.round(sal + ovh),
      });
    }

    const rows = await c.bdCommission.findMany({
      where: {
        bdId,
        completedMonthKey: monthKey,
        paidAt: null,
        exceptionPaidAt: null,
      },
      select: { netPkr: true, workerPayoutPkr: true, allowedHours: true },
    });

    const excludedPaidCount = await c.bdCommission.count({
      where: {
        bdId,
        completedMonthKey: monthKey,
        OR: [{ paidAt: { not: null } }, { exceptionPaidAt: { not: null } }],
      },
    });

    const revenuePkr = rows.reduce((a, r) => a + toNum(r.netPkr), 0);
    const remotePayoutPkr = rows.reduce((a, r) => a + toNum(r.workerPayoutPkr), 0);
    const usedHours = rows.reduce((a, r) => a + (r.allowedHours ?? 0), 0);

    const costBaseFullPkr = Math.round(costSalaries + costOverhead);
    const costBasePkr = Math.round(costBaseFullPkr * proration);
    const profitPkr = Math.round(revenuePkr - remotePayoutPkr - costBasePkr);
    const payoutPkr = Math.max(0, Math.round(profitPkr * bd.bdRate));

    settlements.push({
      bdId,
      bdName: bd.bdName,
      bdRate: bd.bdRate,
      revenuePkr: Math.round(revenuePkr),
      remotePayoutPkr: Math.round(remotePayoutPkr),
      costSalariesPkr: Math.round(costSalaries * proration),
      costOverheadPkr: Math.round(costOverhead * proration),
      costBasePkr,
      costBaseFullPkr,
      profitPkr,
      payoutPkr,
      projectCount: rows.length,
      excludedPaidCount,
      capacityHours: Number(capacityHours.toFixed(2)),
      usedHours,
      allocations: allocOut.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  settlements.sort((a, b) => a.bdName.localeCompare(b.bdName));

  return {
    monthKey,
    costBase,
    settlements,
    warnings,
    elapsedWorkDays,
    workDaysInMonth,
    prorationPct: Number((proration * 100).toFixed(2)),
    isCurrentMonth,
  };
}

/** Compute and persist. Returns the run so the caller can surface warnings. */
export async function recomputeBdSettlements(
  monthKey: string,
  client?: Db
): Promise<SettlementRun> {
  const c = db(client);
  const run = await computeBdSettlements(monthKey, c);

  for (const s of run.settlements) {
    const data = {
      bdRate: s.bdRate.toFixed(4),
      revenuePkr: s.revenuePkr.toFixed(2),
      remotePayoutPkr: s.remotePayoutPkr.toFixed(2),
      costSalariesPkr: s.costSalariesPkr.toFixed(2),
      costOverheadPkr: s.costOverheadPkr.toFixed(2),
      costBasePkr: s.costBasePkr.toFixed(2),
      costBaseFullPkr: s.costBaseFullPkr.toFixed(2),
      prorationPct: run.prorationPct.toFixed(2),
      elapsedWorkDays: run.elapsedWorkDays,
      workDaysInMonth: run.workDaysInMonth,
      profitPkr: s.profitPkr.toFixed(2),
      payoutPkr: s.payoutPkr.toFixed(2),
      projectCount: s.projectCount,
      excludedPaidCount: s.excludedPaidCount,
      capacityHours: s.capacityHours.toFixed(2),
      usedHours: s.usedHours.toFixed(2),
      computedAt: new Date(),
    };

    await c.bdMonthlySettlement.upsert({
      where: { monthKey_bdId: { monthKey, bdId: s.bdId } },
      create: { monthKey, bdId: s.bdId, ...data },
      update: data,
    });
  }

  return run;
}
