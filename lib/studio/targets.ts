import { getPrisma } from "@/lib/prisma";
import { SYSTEM_BD_EMAIL, SYSTEM_BD_KEY } from "@/lib/bd-commission/constants";
import { expenseTotalPkr, monthBoundsUTC } from "./cost-model";

/**
 * STUDIO model target maths.
 *
 *   k            = month expenses (PKR) / sum of all BD targets (USD)
 *   expenseShare = k x BD target            (= expenses x target / total)
 *
 * k is one company-wide number: every BD carries the same PKR per target dollar.
 */

const prisma = getPrisma();

export const TARGET_MULTIPLE = 2;

function num(v: unknown): number {
  const n = Number((v as { toString?: () => string })?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export type UsdTargetRow = {
  bdId: string;
  name: string;
  isSystem: boolean;
  /** Saved for this month, or null. */
  savedUsd: number | null;
  /** Prefill: saved value, else the latest earlier month's target. */
  defaultUsd: number | null;
  /** Gross USD of first-completed, non-sample projects over the 3 months before. */
  avg3mUsd: number;
};

export type UsdTargetEditorData = {
  monthKey: string;
  rows: UsdTargetRow[];
  copiedFrom: string | null;
  expensesPkr: number;
  fx: number;
  fxMonthKey: string | null;
  suggestedTotalUsd: number;
  suggestedPerBdUsd: number;
  savedTotalUsd: number;
  /** PKR per target dollar, from saved targets. 0 when none saved. */
  kPkrPerUsd: number;
};

/** Exact month FX, else latest earlier month with a positive FX. */
export async function resolveFx(monthKey: string): Promise<{ fx: number; fxMonthKey: string | null }> {
  const row = await prisma.monthlyFinanceConfig.findFirst({
    where: { monthKey: { lte: monthKey }, fxRate: { gt: 0 } },
    orderBy: { monthKey: "desc" },
    select: { monthKey: true, fxRate: true },
  });
  return row ? { fx: num(row.fxRate), fxMonthKey: row.monthKey } : { fx: 0, fxMonthKey: null };
}

export async function loadUsdTargetEditor(monthKey: string): Promise<UsdTargetEditorData> {
  const bdUsers = await prisma.user.findMany({
    where: { role: "BUSINESS_DEVELOPER" as any, archivedAt: null },
    orderBy: [{ fullName: "asc" }],
    select: { id: true, fullName: true, username: true, email: true },
  });
  const bds = bdUsers
    .map((b) => ({
      id: b.id,
      name: b.fullName,
      isSystem: b.username === SYSTEM_BD_KEY || b.email === SYSTEM_BD_EMAIL,
    }))
    .sort((a, b) => (a.isSystem === b.isSystem ? 0 : a.isSystem ? -1 : 1));
  const ids = bds.map((b) => b.id);

  const saved = await prisma.bdMonthTarget.findMany({
    where: { monthKey, bdId: { in: ids } },
    select: { bdId: true, targetUsd: true },
  });
  const savedBy = new Map(saved.map((s) => [s.bdId, num(s.targetUsd)]));

  // Copy-forward prefill (form only, never saved until you click Save).
  let priorBy = new Map<string, number>();
  let copiedFrom: string | null = null;
  if (saved.length === 0) {
    const prior = await prisma.bdMonthTarget.findFirst({
      where: { monthKey: { lt: monthKey } },
      orderBy: { monthKey: "desc" },
      select: { monthKey: true },
    });
    if (prior) {
      const rows = await prisma.bdMonthTarget.findMany({
        where: { monthKey: prior.monthKey, bdId: { in: ids } },
        select: { bdId: true, targetUsd: true },
      });
      priorBy = new Map(rows.map((r) => [r.bdId, num(r.targetUsd)]));
      copiedFrom = prior.monthKey;
    }
  }

  // 3-month sales average per BD (gross USD, by first completion).
  const { start } = monthBoundsUTC(monthKey);
  const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 3, 1));
  const sold = await prisma.project.findMany({
    where: {
      bdOwnerId: { in: ids },
      isSample: false,
      firstCompletedAt: { gte: from, lt: start },
    },
    select: { bdOwnerId: true, finance: { select: { priceUsd: true } } },
  });
  const soldBy = new Map<string, number>();
  for (const p of sold) {
    if (!p.bdOwnerId) continue;
    soldBy.set(p.bdOwnerId, (soldBy.get(p.bdOwnerId) ?? 0) + num(p.finance?.priceUsd));
  }

  const [expensesPkr, fxRes] = await Promise.all([expenseTotalPkr(monthKey), resolveFx(monthKey)]);
  const suggestedTotalUsd = fxRes.fx > 0 ? (TARGET_MULTIPLE * expensesPkr) / fxRes.fx : 0;
  const savedTotalUsd = saved.reduce((a, s) => a + num(s.targetUsd), 0);

  return {
    monthKey,
    rows: bds.map((b) => ({
      bdId: b.id,
      name: b.name,
      isSystem: b.isSystem,
      savedUsd: savedBy.get(b.id) ?? null,
      defaultUsd: savedBy.get(b.id) ?? priorBy.get(b.id) ?? null,
      avg3mUsd: Math.round(((soldBy.get(b.id) ?? 0) / 3) * 100) / 100,
    })),
    copiedFrom,
    expensesPkr,
    fx: fxRes.fx,
    fxMonthKey: fxRes.fxMonthKey,
    suggestedTotalUsd: Math.round(suggestedTotalUsd),
    suggestedPerBdUsd: bds.length ? Math.round(suggestedTotalUsd / bds.length) : 0,
    savedTotalUsd: Math.round(savedTotalUsd * 100) / 100,
    kPkrPerUsd: savedTotalUsd > 0 ? Math.round((expensesPkr / savedTotalUsd) * 100) / 100 : 0,
  };
}
