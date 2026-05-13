// lib/bd-commission/estimate.ts
import type { Prisma } from "@prisma/client";

export type FinanceSnapshot = {
  workType: "ONSITE" | "REMOTE" | string;
  priceUsd: Prisma.Decimal | number | string | null;
platformFeePercent: Prisma.Decimal | number | string | null;  allowedHours: number | null;
};

export type MonthConfig = {
  fxRate: Prisma.Decimal | number | string; // ✅ comes from MonthlyFinanceConfig
  avgOnsiteHourCostPkr: Prisma.Decimal | number | string;
  remoteOverheadFixedPkr: Prisma.Decimal | number | string;
};

function toNum(v: any) {
  const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export async function estimateRemoteWorkerPayoutPkr(_projectId: string) {
  // Wire later to your remote payment expected payouts if you want.
  return 0;
}

export async function estimateActiveProfitPkr(args: {
  projectId: string;
  finance: FinanceSnapshot | null;
  config: MonthConfig | null;
}) {
  const { projectId, finance, config } = args;
  if (!finance || !config) return null;

  const priceUsd = toNum(finance.priceUsd);
const feePct = toNum(finance.platformFeePercent);
const feeUsd = Math.max(0, priceUsd * (feePct / 100));  const fxRate = toNum(config.fxRate);

  if (!fxRate || fxRate <= 0) return null;

  const netUsd = Math.max(0, priceUsd - feeUsd);
  const netPkr = netUsd * fxRate;

  if (finance.workType === "ONSITE") {
    const allowedHours = finance.allowedHours ?? 0;
    const avgHourCost = toNum(config.avgOnsiteHourCostPkr);
    const overhead = allowedHours * avgHourCost;
    return netPkr - overhead;
  }

  if (finance.workType === "REMOTE") {
    const remoteOverhead = toNum(config.remoteOverheadFixedPkr);
    const remoteWorkers = await estimateRemoteWorkerPayoutPkr(projectId);
    return netPkr - remoteOverhead - remoteWorkers;
  }

  return null;
}