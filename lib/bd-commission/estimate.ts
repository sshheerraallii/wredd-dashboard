// lib/bd-commission/estimate.ts
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

function toNum(v: any) {
  const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export async function estimateRemoteWorkerPayoutPkr(_projectId: string) {
  return 0;
}

export async function estimateActiveProfitPkr(args: {
  projectId: string;
  finance: {
    workType: string;
    priceUsd: any;
    platformFeePercent: any;
  } | null;
  config: {
    fxRate: any;
    avgOnsiteHourCostPkr: any;
    remoteOverheadFixedPkr: any;
  } | null;
}) {
  const { projectId, finance, config } = args;
  if (!finance || !config) return null;

  const priceUsd = toNum(finance.priceUsd);
  const feePct = toNum(finance.platformFeePercent);
  const feeUsd = Math.max(0, priceUsd * (feePct / 100));
  const fxRate = toNum(config.fxRate);

  if (!fxRate || fxRate <= 0) return null;

  const netUsd = Math.max(0, priceUsd - feeUsd);
  const netPkr = netUsd * fxRate;

  if (finance.workType === "ONSITE") {
    // Per-worker cost: SUM(allocatedHours × worker.onsiteHourRatePkr ?? avgOnsiteHourCostPkr)
    const avgHourCost = toNum(config.avgOnsiteHourCostPkr);

    const assignments = await prisma.projectAssignment.findMany({
      where: {
        projectId,
        unassignedAt: null,
        outcome: { not: "CANCELLED" as any },
        user: { role: "ONSITE_EMPLOYEE" as any },
      },
      select: {
        allocatedHours: true,
        user: { select: { onsiteHourRatePkr: true } },
      },
    });

    let overhead = 0;
    for (const a of assignments) {
      const hours = a.allocatedHours ?? 0;
      const rate = a.user.onsiteHourRatePkr != null
        ? Number(a.user.onsiteHourRatePkr)
        : avgHourCost;
      overhead += hours * rate;
    }

    return netPkr - overhead;
  }

  if (finance.workType === "REMOTE") {
    const remoteOverhead = toNum(config.remoteOverheadFixedPkr);
    const remoteWorkers = await estimateRemoteWorkerPayoutPkr(projectId);
    return netPkr - remoteOverhead - remoteWorkers;
  }

  return null;
}