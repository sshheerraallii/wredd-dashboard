// lib/bd-commission/upsert-bd-commission.ts
"use server";

import {
  Prisma,
  BdCommissionTab,
  PaymentLineStatus,
  Role,
  WorkType,
} from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * YYYY-MM (e.g. 2026-02)
 */
function monthKeyFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function firstOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function tenthOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 10);
}

function toDec(v: unknown, fallback = "0") {
  try {
    if (v === null || v === undefined || v === "") return new Prisma.Decimal(fallback);
    return new Prisma.Decimal(v as any);
  } catch {
    return new Prisma.Decimal(fallback);
  }
}

function clampPct(v: Prisma.Decimal) {
  if (v.lt(0)) return new Prisma.Decimal(0);
  if (v.gt(100)) return new Prisma.Decimal(100);
  return v;
}

/**
 * feePercent e.g. 20.00 means 20%
 * returns feeUsd rounded to 2 dp.
 */
function computeFeeUsd(priceUsd: Prisma.Decimal, feePercent: Prisma.Decimal) {
  const pct = clampPct(feePercent);
  if (pct.lte(0)) return new Prisma.Decimal(0);
  return priceUsd.mul(pct).div(100).toDecimalPlaces(2);
}

/**
 * Remote worker payout total (PKR)
 * Rule:
 * - Take the latest non-VOIDED payment line per REMOTE_WORKER (distinct userId)
 * - Sum amounts
 *
 * NOTE: Assumes ProjectPaymentLine.amount is PKR.
 */
async function getRemoteWorkerPayoutTotalPkr(
  tx: Prisma.TransactionClient,
  projectId: string
) {
  const lines = await tx.projectPaymentLine.findMany({
    where: {
      projectId,
      status: { not: PaymentLineStatus.VOIDED },
      user: { role: Role.REMOTE_WORKER },
    },
    orderBy: { createdAt: "desc" },
    distinct: ["userId"],
    select: { amount: true },
  });

  let sum = new Prisma.Decimal("0.00");
  for (const l of lines) sum = sum.add(toDec(l.amount, "0.00"));
  return sum;
}

/**
 * Upserts BdCommission ledger row for a completed project.
 *
 * Invariants:
 * - BdCommission.tab must NEVER be ACTIVE (ACTIVE is UI-only)
 * - New rows always start at CLEARING
 * - Existing rows keep their current tab (CLEARING/DUE/PAID),
 *   except:
 *    - if paidAt or exceptionPaidAt is set => force PAID
 *    - if tab is somehow ACTIVE => force CLEARING
 *
 * Requires:
 * - project.firstCompletedAt exists
 * - project.finance exists
 * - project.bdOwnerId exists
 * - MonthlyFinanceConfig exists for completedMonthKey
 */
export async function upsertBdCommissionForProject(projectId: string) {
  if (!projectId) return;

  await prisma.$transaction(async (tx) => {
    // 1) Load project + finance + bd owner
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { finance: true, bdOwner: true },
    });

    if (!project?.firstCompletedAt) return;
    if (!project.finance) return;
    if (!project.bdOwnerId) return;

    // 2) Month + config
    const completedMonthKey = monthKeyFromDate(project.firstCompletedAt);

    const config = await tx.monthlyFinanceConfig.findUnique({
      where: { monthKey: completedMonthKey },
      select: {
        monthKey: true,
        fxRate: true,
        avgOnsiteHourCostPkr: true,
        remoteOverheadFixedPkr: true,
      },
    });
    if (!config) return;

    // 3) BD rate (decimal fraction: 0.35 = 35%)
    const bdRate = project.bdOwner?.bdCommissionRate
      ? toDec(project.bdOwner.bdCommissionRate, "0")
      : new Prisma.Decimal(0);

    // 4) NET (USD -> PKR) using fee PERCENT (and store fee USD snapshot)
    const priceUsd = toDec(project.finance.priceUsd, "0");

    const platformFeePercent = project.finance.platformFeePercent
      ? toDec(project.finance.platformFeePercent, "0")
      : new Prisma.Decimal(0);

    // ✅ fee in USD computed from percent (rounded 2dp)
    const platformFeeUsd = computeFeeUsd(priceUsd, platformFeePercent);

    const rawNetUsd = priceUsd.minus(platformFeeUsd);
    const netUsd = rawNetUsd.gt(0) ? rawNetUsd : new Prisma.Decimal(0);

    const fxRate = toDec(config.fxRate, "0");
    const netPkr = netUsd.mul(fxRate);

    // 5) COSTS / OVERHEAD
    let overheadPkr = new Prisma.Decimal(0);
    let workerPayoutPkr = new Prisma.Decimal(0);

    if (project.finance.workType === WorkType.REMOTE) {
      overheadPkr = toDec(config.remoteOverheadFixedPkr, "0");
      workerPayoutPkr = await getRemoteWorkerPayoutTotalPkr(tx, projectId);
    } else {
      const hours = Number(project.finance.allowedHours ?? 0);
      const avgHourCost = toDec(config.avgOnsiteHourCostPkr, "0");
      overheadPkr = new Prisma.Decimal(hours).mul(avgHourCost);
      workerPayoutPkr = new Prisma.Decimal(0);
    }

    const totalCostPkr = overheadPkr.add(workerPayoutPkr);

    // 6) PROFIT
    const profitPkr = netPkr.minus(totalCostPkr);

   // 7) BD PAYOUT + COMPANY SHARE
    // Both parties share losses proportionally — BD payout can be negative
    // (negative bdPayoutPkr deducts from BD's running ledger total)
    const bdPayoutPkr = profitPkr.mul(bdRate);
    const companySharePkr = profitPkr.minus(bdPayoutPkr);

    // 8) Dates
    const dueOn = firstOfNextMonth(project.firstCompletedAt);
    const payableOn = tenthOfNextMonth(project.firstCompletedAt);

    // 9) Preserve / force correct tab
    const existing = await tx.bdCommission.findUnique({
      where: { projectId_completedMonthKey: { projectId, completedMonthKey } },
      select: { tab: true, paidAt: true, exceptionPaidAt: true },
    });

    let nextTab: BdCommissionTab;
    if (!existing) {
      nextTab = BdCommissionTab.CLEARING;
    } else if (
      existing.paidAt ||
      existing.exceptionPaidAt ||
      existing.tab === BdCommissionTab.PAID
    ) {
      nextTab = BdCommissionTab.PAID;
    } else if ((existing.tab as any) === "ACTIVE") {
      nextTab = BdCommissionTab.CLEARING;
    } else {
      nextTab = existing.tab; // CLEARING or DUE
    }

    // 10) Upsert
    await tx.bdCommission.upsert({
      where: { projectId_completedMonthKey: { projectId, completedMonthKey } },
      create: {
        projectId,
        bdId: project.bdOwnerId,
        completedMonthKey,

        // ✅ never ACTIVE in DB, always start CLEARING
        tab: BdCommissionTab.CLEARING,

        dueOn,
        payableOn,

        workType: project.finance.workType,
        portal: project.finance.portal,

        priceUsd,
        platformFeePercent,
        platformFeeUsd, // ✅ REQUIRED snapshot

        fxRate,

        avgOnsiteHourCostPkr: config.avgOnsiteHourCostPkr,
        remoteOverheadFixedPkr: config.remoteOverheadFixedPkr,

        allowedHours: project.finance.allowedHours,

        bdRate,

        netUsd,
        netPkr,

        overheadPkr,
        profitPkr,

        bdPayoutPkr,
        companySharePkr,
      },
      update: {
        tab: nextTab,

        dueOn,
        payableOn,

        workType: project.finance.workType,
        portal: project.finance.portal,

        priceUsd,
        platformFeePercent,
        platformFeeUsd, // ✅ keep updated if finance changes

        fxRate,

        avgOnsiteHourCostPkr: config.avgOnsiteHourCostPkr,
        remoteOverheadFixedPkr: config.remoteOverheadFixedPkr,

        allowedHours: project.finance.allowedHours,

        bdRate,

        netUsd,
        netPkr,

        overheadPkr,
        profitPkr,

        bdPayoutPkr,
        companySharePkr,
      },
    });
  });
}