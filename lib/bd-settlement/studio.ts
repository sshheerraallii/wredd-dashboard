import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { countWeekdays, monthBounds } from "./cost-base";
import type { BdSettlement, SettlementProject } from "./compute";

/**
 * STUDIO model settlement for one segment of a month.
 *
 *   E        = month expense ledger total (PKR)
 *   k        = E / sum of all BD targets (USD)   — PKR charged per target dollar
 *   share    = k x BD target                     — the BD's slice of the month's expenses
 *   charged  = share x (segment working days elapsed / month working days)
 *
 *   profit   = net - remote payouts - direct costs - charged
 *   payout   = max(0, profit x rate)             (floored after segments are merged)
 *
 * Per project the expense is price x k, so a BD who sells exactly their target
 * is charged exactly their share. The residual line in attribution is the
 * unsold part of the target (negative) or the over-target credit (positive).
 */

type Db = Prisma.TransactionClient;

function toNum(v: unknown): number {
  const n = Number((v as { toString?: () => string })?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export type StudioSegmentResult = {
  settlements: BdSettlement[];
  warnings: string[];
  expensesPkr: number;
  totalTargetUsd: number;
  kPkrPerUsd: number;
};

export async function computeStudioSegment(
  monthKey: string,
  c: Db,
  window: { from: Date; to: Date },
  now: Date = new Date()
): Promise<StudioSegmentResult> {
  const warnings: string[] = [];
  const { start, end } = monthBounds(monthKey);
  const workDaysInMonth = countWeekdays(start, end) || 1;

  const isCurrentMonth = now >= start && now < end;
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  const cutoff = isCurrentMonth ? tomorrow : end;
  const segTo = window.to < cutoff ? window.to : cutoff;

  const segFullFactor = countWeekdays(window.from, window.to) / workDaysInMonth;
  const segElapsedFactor =
    segTo > window.from ? countWeekdays(window.from, segTo) / workDaysInMonth : 0;

  const [expenseAgg, targets] = await Promise.all([
    c.monthlyExpense.aggregate({ where: { monthKey }, _sum: { amountPkr: true } }),
    c.bdMonthTarget.findMany({
      where: { monthKey },
      select: { bdId: true, targetUsd: true },
    }),
  ]);

  const expensesPkr = expenseAgg._sum.amountPkr ?? 0;
  const targetBy = new Map(targets.map((t) => [t.bdId, toNum(t.targetUsd)]));
  const totalTargetUsd = targets.reduce((a, t) => a + toNum(t.targetUsd), 0);
  const k = totalTargetUsd > 0 ? expensesPkr / totalTargetUsd : 0;

  if (expensesPkr <= 0) {
    warnings.push(
      `No expenses entered for ${monthKey}. Add them in Finance Config → Expenses or every BD is charged nothing.`
    );
  }
  if (totalTargetUsd <= 0) {
    warnings.push(
      `No BD targets for ${monthKey}. Set them in BD Targets — without targets the month's expenses are charged to nobody.`
    );
  }

  const rows = await c.bdCommission.findMany({
    where: {
      completedMonthKey: monthKey,
      paidAt: null,
      exceptionPaidAt: null,
      project: { firstCompletedAt: { gte: window.from, lt: window.to } },
    },
    select: {
      id: true,
      bdId: true,
      projectId: true,
      priceUsd: true,
      netPkr: true,
      workerPayoutPkr: true,
      workType: true,
      project: { select: { title: true, finance: { select: { directCostPkr: true } } } },
    },
  });

  const excluded = await c.bdCommission.groupBy({
    by: ["bdId"],
    where: {
      completedMonthKey: monthKey,
      project: { firstCompletedAt: { gte: window.from, lt: window.to } },
      OR: [{ paidAt: { not: null } }, { exceptionPaidAt: { not: null } }],
    },
    _count: { _all: true },
  });
  const excludedBy = new Map(excluded.map((e) => [e.bdId, e._count._all]));

  const bdIds = Array.from(new Set([...targetBy.keys(), ...rows.map((r) => r.bdId)]));
  const users = await c.user.findMany({
    where: { id: { in: bdIds } },
    select: { id: true, fullName: true, bdCommissionRate: true },
  });
  const userBy = new Map(users.map((u) => [u.id, u]));

  const settlements: BdSettlement[] = [];

  for (const bdId of bdIds) {
    const u = userBy.get(bdId);
    const bdName = u?.fullName ?? bdId;
    const bdRate = toNum(u?.bdCommissionRate);
    const targetUsd = targetBy.get(bdId) ?? 0;
    const mine = rows.filter((r) => r.bdId === bdId);

    if (targetUsd <= 0 && mine.length > 0) {
      warnings.push(
        `${bdName} has completed sales in ${monthKey} but no target, so carries none of the month's expenses.`
      );
    }

    const shareFull = k * targetUsd; // whole month
    const shareSegFull = shareFull * segFullFactor;
    const charged = shareFull * segElapsedFactor;

    const projects: SettlementProject[] = mine.map((r) => {
      const priceUsd = toNum(r.priceUsd);
      return {
        projectId: r.projectId,
        title: r.project?.title ?? r.projectId,
        workType: String(r.workType),
        netPkr: toNum(r.netPkr),
        remotePayoutPkr: toNum(r.workerPayoutPkr),
        bdCommissionId: r.id,
        hours: 0,
        allocatedHours: 0,
        overridden: false,
        overrideNote: null,
        model: "STUDIO",
        priceUsd,
        directCostPkr: toNum(r.project?.finance?.directCostPkr),
        chargePkr: priceUsd * k,
      };
    });

    const revenuePkr = projects.reduce((a, p) => a + p.netPkr, 0);
    const remotePayoutPkr = projects.reduce((a, p) => a + p.remotePayoutPkr, 0);
    const directCostPkr = projects.reduce((a, p) => a + p.directCostPkr, 0);
    const achievedUsd = projects.reduce((a, p) => a + p.priceUsd, 0);
    const profitPkr = Math.round(revenuePkr - remotePayoutPkr - directCostPkr - charged);

    settlements.push({
      bdId,
      bdName,
      bdRate,
      model: "STUDIO",
      revenuePkr: Math.round(revenuePkr),
      remotePayoutPkr: Math.round(remotePayoutPkr),
      directCostPkr: Math.round(directCostPkr),
      costSalariesPkr: 0,
      costOverheadPkr: 0,
      expenseSharePkr: Math.round(charged),
      expenseShareFullPkr: Math.round(shareSegFull),
      costBasePkr: Math.round(charged),
      costBaseFullPkr: Math.round(shareSegFull),
      profitPkr,
      payoutPkr: Math.max(0, Math.round(profitPkr * bdRate)),
      projectCount: projects.length,
      excludedPaidCount: excludedBy.get(bdId) ?? 0,
      capacityHours: 0,
      usedHours: 0,
      targetUsd: targetUsd * segFullFactor,
      targetToDateUsd: targetUsd * segElapsedFactor,
      achievedUsd,
      kPkrPerUsd: k,
      allocations: [],
      projects,
    });
  }

  return {
    settlements,
    warnings,
    expensesPkr,
    totalTargetUsd,
    kPkrPerUsd: k,
  };
}
