// lib/bd-commission/queries.ts
import { getPrisma } from "@/lib/prisma";
import { estimateActiveProfitPkr } from "./estimate";
import { BdCommissionTab } from "@prisma/client";

/**
 * YYYY-MM (e.g. 2026-02)
 */
export function monthKeyFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function norm(v?: string | null) {
  const s = (v ?? "").trim();
  return s.length ? s : undefined;
}

function clampPerPage(n: number) {
  if (n === 10 || n === 20 || n === 50 || n === 100) return n;
  return 20;
}

function clampPage(n: number) {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export async function getMonthConfig(monthKey: string) {
  const prisma = getPrisma();
  return prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: {
      monthKey: true,
      fxRate: true,
      avgOnsiteHourCostPkr: true,
      remoteOverheadFixedPkr: true,
    },
  });
}

/**
 * ACTIVE = projects not yet first-completed, but have finance.
 * IMPORTANT: CANCELLED projects must NOT appear in ACTIVE.
 * (UNASSIGNED is allowed per your rules.)
 */
export async function getActiveBdProjectsWithEstimates(params: {
  bdId?: string;
  search?: string;
  monthKey?: string; // config monthKey; default = current month
  page?: number;
  perPage?: number;
}) {
  const prisma = getPrisma();

  const bdId = norm(params.bdId);
  const search = norm(params.search);

  const monthKey = norm(params.monthKey) ?? monthKeyFromDate(new Date());
  const config = await getMonthConfig(monthKey);

  const page = clampPage(Number(params.page ?? 1));
  const perPage = clampPerPage(Number(params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const where: any = {
    ...(bdId ? { bdOwnerId: bdId } : {}),

    // ACTIVE definition
    firstCompletedAt: null,
    finance: { isNot: null },

    // ✅ FIX: Cancelled must never show in ACTIVE
    status: { not: "CANCELLED" },

    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
            { finance: { is: { clientName: { contains: search, mode: "insensitive" } } } },
            { finance: { is: { clientUsername: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        bdOwner: { select: { id: true, fullName: true, username: true } },
        finance: {
          select: {
            clientName: true,
            clientUsername: true,
            portal: true,
            workType: true,
            priceUsd: true,
            platformFeePercent: true,
            allowedHours: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
  ]);

  const withEst = await Promise.all(
    rows.map(async (p) => {
      const estimatedProfitPkr = await estimateActiveProfitPkr({
        projectId: p.id,
        finance: p.finance,
        config: config
          ? {
              fxRate: config.fxRate,
              avgOnsiteHourCostPkr: config.avgOnsiteHourCostPkr,
              remoteOverheadFixedPkr: config.remoteOverheadFixedPkr,
            }
          : null,
      });

      return {
        ...p,
        estimatedProfitPkr,
        estimateMonthKey: monthKey,
        estimateHasConfig: !!config,
      };
    })
  );

  return {
    rows: withEst,
    total,
    page,
    perPage,
    monthKeyUsed: monthKey,
    hasConfig: !!config,
  };
}

type Kind = "commission" | "adjustment";

/**
 * Ledger for CLEARING / DUE / PAID tabs:
 * - Combines BdCommission + BdCommissionAdjustment into one list
 * - Month filter:
 *   - commissions: completedMonthKey
 *   - adjustments: monthKey
 * - Pagination is done after merge-sort (in-memory) to preserve correct ordering
 */
export async function getBdCommissionLedger(params: {
  tab: BdCommissionTab; // CLEARING / DUE / PAID (NEVER ACTIVE)
  monthKey?: string;
  bdId?: string;
  search?: string;
  page?: number;
  perPage?: number;
}) {
  const prisma = getPrisma();

  const tab = params.tab;
  const monthKey = norm(params.monthKey);
  const bdId = norm(params.bdId);
  const search = norm(params.search);

  const page = clampPage(Number(params.page ?? 1));
  const perPage = clampPerPage(Number(params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const whereCommission: any = {
    tab,
    ...(monthKey ? { completedMonthKey: monthKey } : {}),
    ...(bdId ? { bdId } : {}),
    ...(search
      ? {
          OR: [
            { projectId: { contains: search, mode: "insensitive" } },
            { completedMonthKey: { contains: search, mode: "insensitive" } },
            { bd: { is: { fullName: { contains: search, mode: "insensitive" } } } },
            { bd: { is: { username: { contains: search, mode: "insensitive" } } } },
            { project: { is: { title: { contains: search, mode: "insensitive" } } } },
            { project: { is: { finance: { is: { clientName: { contains: search, mode: "insensitive" } } } } } },
            { project: { is: { finance: { is: { clientUsername: { contains: search, mode: "insensitive" } } } } } },
          ],
        }
      : {}),
  };

  const whereAdj: any = {
    tab,
    ...(monthKey ? { monthKey } : {}),
    ...(bdId ? { bdUserId: bdId } : {}),
    ...(search
      ? {
          OR: [
            { note: { contains: search, mode: "insensitive" } },
            { monthKey: { contains: search, mode: "insensitive" } },
            { bdUser: { is: { fullName: { contains: search, mode: "insensitive" } } } },
            { bdUser: { is: { username: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [countComm, countAdj] = await Promise.all([
    prisma.bdCommission.count({ where: whereCommission }),
    prisma.bdCommissionAdjustment.count({ where: whereAdj }),
  ]);

  const total = countComm + countAdj;

  // fetch enough to merge-sort, then slice
  const need = skip + perPage;

  const [commRows, adjRows] = await Promise.all([
    prisma.bdCommission.findMany({
      where: whereCommission,
      select: {
        id: true,
        projectId: true,
        bdId: true,
        completedMonthKey: true,
        tab: true,
        dueOn: true,
        payableOn: true,
        paidAt: true,
        paidNote: true,
        paidById: true,
        exceptionPaidAt: true,
        exceptionPaidNote: true,
        exceptionPaidById: true,
        workType: true,
        portal: true,
        priceUsd: true,
        platformFeePercent: true,
        fxRate: true,
        avgOnsiteHourCostPkr: true,
        remoteOverheadFixedPkr: true,
        allowedHours: true,
        netUsd: true,
        netPkr: true,
        overheadPkr: true,
        profitPkr: true,
        bdPayoutPkr: true,
        companySharePkr: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            title: true,
            status: true,
            firstCompletedAt: true,
            bdOwner: { select: { id: true, fullName: true, username: true } },
            finance: { select: { clientName: true, clientUsername: true } },
          },
        },
        bd: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: [{ completedMonthKey: "desc" }, { dueOn: "asc" }, { createdAt: "desc" }],
      take: Math.max(need, 200), // safety: avoid underfetch when mixing
    }),

    prisma.bdCommissionAdjustment.findMany({
      where: whereAdj,
      select: {
        id: true,
        bdUserId: true,
        monthKey: true,
        tab: true,
        amountPkr: true,
        note: true,
        dueOn: true,
        paidAt: true,
        createdAt: true,
        bdUser: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: [{ monthKey: "desc" }, { dueOn: "asc" }, { createdAt: "desc" }],
      take: Math.max(need, 200),
    }),
  ]);

  const mappedComm = commRows.map((r) => ({
    kind: "commission" as Kind,
    ...r,
  }));

  const mappedAdj = adjRows.map((a) => ({
    kind: "adjustment" as Kind,
    id: a.id,
    projectId: null,
    bdId: a.bdUserId,
    completedMonthKey: a.monthKey,
    tab: a.tab,
    dueOn: a.dueOn,
    payableOn: null,
    paidAt: a.paidAt ?? null,
    paidNote: null,
    paidById: null,
    exceptionPaidAt: null,
    exceptionPaidNote: null,
    exceptionPaidById: null,
    workType: null,
    portal: null,
    priceUsd: null,
    platformFeePercent: null,
    fxRate: null,
    avgOnsiteHourCostPkr: null,
    remoteOverheadFixedPkr: null,
    allowedHours: null,
    netUsd: null,
    netPkr: null,
    overheadPkr: "0",
    profitPkr: "0",
    bdPayoutPkr: a.amountPkr,
    companySharePkr: "0",
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
    project: null,
    bd: a.bdUser,
    __note: a.note,
  }));

  function keyMonth(row: any) {
    return String(row.completedMonthKey ?? "");
  }
  function keyDue(row: any) {
    return row.dueOn ? new Date(row.dueOn).getTime() : 0;
  }
  function keyCreated(row: any) {
    return row.createdAt ? new Date(row.createdAt).getTime() : 0;
  }

  const merged = [...mappedComm, ...mappedAdj].sort((a, b) => {
    const am = keyMonth(a);
    const bm = keyMonth(b);
    if (am !== bm) return am > bm ? -1 : 1;

    const ad = keyDue(a);
    const bd = keyDue(b);
    if (ad !== bd) return ad - bd;

    const ac = keyCreated(a);
    const bc = keyCreated(b);
    return bc - ac;
  });

  const rows = merged.slice(skip, skip + perPage);

  return { rows, total, page, perPage };
}

/**
 * Backwards-compatible export (kept; optional).
 * IMPORTANT: Must match ACTIVE rules and exclude CANCELLED.
 */
export async function getActiveBdProjects(params: {
  bdId?: string;
  monthRange?: { from: Date; to: Date }; // unused here
  search?: string;
}) {
  const prisma = getPrisma();

  const bdId = norm(params.bdId);
  const search = norm(params.search);

  return prisma.project.findMany({
    where: {
      ...(bdId ? { bdOwnerId: bdId } : {}),
      firstCompletedAt: null,
      finance: { isNot: null },

      // ✅ FIX: Cancelled must never show in ACTIVE
      status: { not: "CANCELLED" },

      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
              { finance: { is: { clientName: { contains: search, mode: "insensitive" } } } },
              { finance: { is: { clientUsername: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      bdOwner: { select: { id: true, fullName: true, username: true } },
      finance: {
        select: {
          clientName: true,
          clientUsername: true,
          portal: true,
          workType: true,
          priceUsd: true,
         platformFeePercent: true,
          allowedHours: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}