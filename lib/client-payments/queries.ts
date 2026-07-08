// lib/client-payments/queries.ts
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

export type PaymentStatus = "NOT_RECEIVED" | "PARTIALLY_RECEIVED" | "FULLY_RECEIVED";

/**
 * YYYY-MM (e.g. 2026-06)
 */
export function monthKeyFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthRange(monthKey: string) {
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  if (!y || !m) return null;
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

export function deriveStatus(totalReceived: number, targetUsd: number): PaymentStatus {
  if (totalReceived <= 0) return "NOT_RECEIVED";
  if (targetUsd > 0 && totalReceived >= targetUsd) return "FULLY_RECEIVED";
  return "PARTIALLY_RECEIVED";
}

/**
 * Portals (Fiverr/Upwork) deduct their cut before money ever reaches one of
 * our accounts. Comparing receipts against the raw project price makes a
 * fully-settled project look permanently "partial". This computes what
 * should actually land in hand, using the fee snapshot already stored on
 * ProjectFinance (mirrors the same formula bd-commission uses).
 */
export function computeFeeUsd(priceUsd: number, platformFeeUsd: number | null, platformFeePercent: number | null): number {
  if (platformFeeUsd != null && platformFeeUsd > 0) return round2(platformFeeUsd);
  const pct = clampPct(platformFeePercent ?? 0);
  if (pct <= 0) return 0;
  return round2((priceUsd * pct) / 100);
}

function clampPct(v: number) {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type LedgerRow = {
  id: string;
  title: string;
  firstCompletedAt: Date | null;
  department: { id: string; name: string } | null;
  bdOwner: { id: string; fullName: string } | null;
  priceUsd: number;
  feeUsd: number;
  netExpectedUsd: number;
  portal: string;
  clientName: string | null;
  totalReceived: number;
  paymentStatus: PaymentStatus;
  receipts: {
    id: string;
    amountUsd: number;
    fundStatus: string;
    receivedAt: Date;
    account: { id: string; name: string };
  }[];
};

export async function getClientPaymentsLedger(params: {
  monthKey?: string;
  departmentId?: string;
  bdId?: string;
  status?: PaymentStatus | "ALL";
  q?: string;
}): Promise<LedgerRow[]> {
  const { monthKey, departmentId, bdId, status, q } = params;

  const where: any = {
    firstCompletedAt: { not: null },
  };

  if (monthKey) {
    const range = monthRange(monthKey);
    if (range) where.firstCompletedAt = { gte: range.start, lt: range.end };
  }

  if (departmentId) where.departmentId = departmentId;
  if (bdId) where.bdOwnerId = bdId;
  if (q && q.trim()) where.title = { contains: q.trim(), mode: "insensitive" };

  const projects = await prisma.project.findMany({
    where,
    orderBy: { firstCompletedAt: "desc" },
    select: {
      id: true,
      title: true,
      firstCompletedAt: true,
      department: { select: { id: true, name: true } },
      bdOwner: { select: { id: true, fullName: true } },
      finance: {
        select: {
          priceUsd: true,
          clientName: true,
          portal: true,
          platformFeeUsd: true,
          platformFeePercent: true,
        },
      },
      clientPaymentReceipts: {
        select: {
          id: true,
          amountUsd: true,
          fundStatus: true,
          receivedAt: true,
          account: { select: { id: true, name: true } },
        },
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  const rows: LedgerRow[] = projects.map((p) => {
    const priceUsd = Number(p.finance?.priceUsd ?? 0);
    const feeUsd = computeFeeUsd(
      priceUsd,
      p.finance?.platformFeeUsd != null ? Number(p.finance.platformFeeUsd) : null,
      p.finance?.platformFeePercent != null ? Number(p.finance.platformFeePercent) : null
    );
    const netExpectedUsd = Math.max(0, round2(priceUsd - feeUsd));

    const receipts = p.clientPaymentReceipts.map((r) => ({
      id: r.id,
      amountUsd: Number(r.amountUsd),
      fundStatus: r.fundStatus,
      receivedAt: r.receivedAt,
      account: r.account,
    }));
    const totalReceived = receipts.reduce((s, r) => s + r.amountUsd, 0);

    return {
      id: p.id,
      title: p.title,
      firstCompletedAt: p.firstCompletedAt,
      department: p.department,
      bdOwner: p.bdOwner,
      priceUsd,
      feeUsd,
      netExpectedUsd,
      portal: p.finance?.portal ?? "OTHER",
      clientName: p.finance?.clientName ?? null,
      totalReceived,
      paymentStatus: deriveStatus(totalReceived, netExpectedUsd),
      receipts,
    };
  });

  if (status && status !== "ALL") {
    return rows.filter((r) => r.paymentStatus === status);
  }

  return rows;
}

export async function getProjectForPaymentDetail(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      firstCompletedAt: true,
      department: { select: { id: true, name: true } },
      bdOwner: { select: { id: true, fullName: true } },
      finance: {
        select: {
          priceUsd: true,
          clientName: true,
          portal: true,
          platformFeeUsd: true,
          platformFeePercent: true,
        },
      },
      clientPaymentReceipts: {
        orderBy: { receivedAt: "desc" },
        select: {
          id: true,
          amountUsd: true,
          fundStatus: true,
          receivedAt: true,
          note: true,
          statusNote: true,
          statusUpdatedAt: true,
          account: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  if (!project) return null;

  const priceUsd = Number(project.finance?.priceUsd ?? 0);
  const feeUsd = computeFeeUsd(
    priceUsd,
    project.finance?.platformFeeUsd != null ? Number(project.finance.platformFeeUsd) : null,
    project.finance?.platformFeePercent != null ? Number(project.finance.platformFeePercent) : null
  );
  const netExpectedUsd = Math.max(0, round2(priceUsd - feeUsd));
  const totalReceived = project.clientPaymentReceipts.reduce(
    (s, r) => s + Number(r.amountUsd),
    0
  );

  return {
    ...project,
    priceUsd,
    feeUsd,
    netExpectedUsd,
    portal: project.finance?.portal ?? "OTHER",
    totalReceived,
    paymentStatus: deriveStatus(totalReceived, netExpectedUsd),
  };
}

export type SettlementRow = {
  accountId: string;
  accountName: string;
  monthKey: string;
  total: number;
  inHand: number;
  utilized: number;
  settled: number;
};

export async function getSettlementRollup(monthKey?: string): Promise<SettlementRow[]> {
  const where: any = {};
  if (monthKey) {
    const range = monthRange(monthKey);
    if (range) where.receivedAt = { gte: range.start, lt: range.end };
  }

  const receipts = await prisma.clientPaymentReceipt.findMany({
    where,
    select: {
      amountUsd: true,
      fundStatus: true,
      receivedAt: true,
      account: { select: { id: true, name: true } },
    },
  });

  const map = new Map<string, SettlementRow>();

  for (const r of receipts) {
    const mk = monthKeyFromDate(r.receivedAt);
    const key = `${r.account.id}:${mk}`;
    const amt = Number(r.amountUsd);

    if (!map.has(key)) {
      map.set(key, {
        accountId: r.account.id,
        accountName: r.account.name,
        monthKey: mk,
        total: 0,
        inHand: 0,
        utilized: 0,
        settled: 0,
      });
    }

    const row = map.get(key)!;
    row.total += amt;
    if (r.fundStatus === "IN_HAND") row.inHand += amt;
    else if (r.fundStatus === "UTILIZED") row.utilized += amt;
    else row.settled += amt;
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.monthKey !== b.monthKey) return b.monthKey.localeCompare(a.monthKey);
    return a.accountName.localeCompare(b.accountName);
  });
}
