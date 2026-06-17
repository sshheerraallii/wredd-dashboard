// lib/bd-targets/compute.ts
import { getPrisma } from "@/lib/prisma";
import { SYSTEM_BD_KEY, SYSTEM_BD_EMAIL } from "@/lib/bd-commission/constants";
import { DOLLARS_PER_POINT, DEPT_DEFS, ACTIVE_STATUSES, DEFAULT_WORKING_DAYS, type DeptKey } from "./constants";

const prisma = getPrisma();

function num(v: any): number {
  if (v == null) return 0;
  const n = Number(typeof v === "string" ? v : v.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export function monthBoundsUTC(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0)); // exclusive
  return { start, end };
}

/** Proportional working-days elapsed (relative; no calendar of holidays). */
function elapsedWorkingDays(monthKey: string, workingDays: number, now: Date): number {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isCurrent =
    now.getUTCFullYear() === y && now.getUTCMonth() + 1 === m;
  let frac: number;
  if (isCurrent) frac = Math.min(1, now.getUTCDate() / daysInMonth);
  else frac = now >= new Date(Date.UTC(y, m, 1)) ? 1 : 0; // past month = full, future = 0
  return Math.round(workingDays * frac * 100) / 100;
}

/** Exact month config, else most recent prior month with a positive fx. */
async function resolveFx(monthKey: string): Promise<{ fx: number; fxMonthKey: string | null; assumed: boolean }> {
  const exact = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { monthKey: true, fxRate: true },
  });
  if (exact && num(exact.fxRate) > 0) return { fx: num(exact.fxRate), fxMonthKey: exact.monthKey, assumed: false };

  const prior = await prisma.monthlyFinanceConfig.findFirst({
    where: { monthKey: { lt: monthKey }, fxRate: { gt: 0 } },
    orderBy: { monthKey: "desc" },
    select: { monthKey: true, fxRate: true },
  });
  if (prior) return { fx: num(prior.fxRate), fxMonthKey: prior.monthKey, assumed: true };
  return { fx: 0, fxMonthKey: null, assumed: true };
}

export type Buckets = { achievedUsd: number; activeUsd: number; backlogUsd: number };

export type SignalSet = {
  gapUsd: number; // target - (achieved+active+backlog); >0 means develop
  coveredUsd: number; // achieved+active+backlog
  runwayDays: number; // (active+backlog)/dailyRate
  daysRemaining: number;
  dailyRateUsd: number;
  /** active+backlog beyond remaining capacity -> routable to remote */
  surplusUsd: number;
  targetSecured: boolean; // gap <= 0
  shortRunway: boolean; // runwayDays < daysRemaining
};

export type DeptResult = {
  key: DeptKey;
  deptId: string | null;
  name: string;
  capacityPoints: number;
  targetUsd: number;
  workingDays: number;
  workingDaysAssumed: boolean;
  buckets: Buckets;
  signals: SignalSet;
};

export type BdDeptSlice = {
  key: DeptKey;
  name: string;
  allocationPct: number;
  allocationAssumed: boolean;
  targetUsd: number;
  buckets: Buckets;
  signals: SignalSet;
};

export type BdResult = {
  bdId: string;
  name: string;
  isSystem: boolean;
  perDept: BdDeptSlice[];
  totalTargetUsd: number;
  totalCoveredUsd: number;
  totalGapUsd: number;
};

export type TargetsComputation = {
  monthKey: string;
  fx: number;
  fxMonthKey: string | null;
  fxAssumed: boolean;
  setupComplete: boolean; // both departments found
  departments: DeptResult[];
  bds: BdResult[];
  totals: { targetUsd: number; achievedUsd: number; activeUsd: number; backlogUsd: number; gapUsd: number };
};

function buildSignals(targetUsd: number, b: Buckets, workingDays: number, daysRemaining: number): SignalSet {
  const coveredUsd = b.achievedUsd + b.activeUsd + b.backlogUsd;
  const gapUsd = Math.round((targetUsd - coveredUsd) * 100) / 100;
  const dailyRateUsd = workingDays > 0 ? targetUsd / workingDays : 0;
  const feedUsd = b.activeUsd + b.backlogUsd;
  const runwayDays = dailyRateUsd > 0 ? Math.round((feedUsd / dailyRateUsd) * 100) / 100 : 0;
  const remainingCapacityUsd = Math.max(0, daysRemaining) * dailyRateUsd;
  const surplusUsd = Math.max(0, Math.round((feedUsd - remainingCapacityUsd) * 100) / 100);
  return {
    gapUsd,
    coveredUsd: Math.round(coveredUsd * 100) / 100,
    runwayDays,
    daysRemaining: Math.round(daysRemaining * 100) / 100,
    dailyRateUsd: Math.round(dailyRateUsd * 100) / 100,
    surplusUsd,
    targetSecured: gapUsd <= 0.01,
    shortRunway: runwayDays < daysRemaining - 0.01,
  };
}

export async function computeTargets(monthKey: string, now: Date = new Date()): Promise<TargetsComputation> {
  const { start, end } = monthBoundsUTC(monthKey);
  const { fx, fxMonthKey, assumed: fxAssumed } = await resolveFx(monthKey);

  // Resolve departments by name or slug.
  const allDepts = await prisma.department.findMany({ select: { id: true, name: true, slug: true } });
  const deptByKey = new Map<DeptKey, { id: string; name: string } | null>();
  for (const def of DEPT_DEFS) {
    const d = allDepts.find((x) => x.name === def.name) ?? allDepts.find((x) => x.slug === def.altSlug) ?? null;
    deptByKey.set(def.key, d ? { id: d.id, name: def.name } : null);
  }
  const setupComplete = DEPT_DEFS.every((def) => deptByKey.get(def.key));

  // Capacity by worker type.
  const onsiteWorkers = await prisma.user.findMany({
    where: { archivedAt: null, workerType: { in: ["ONSITE_ANIMATOR", "ONSITE_VIDEO_EDITOR"] as any } },
    select: { workerType: true, targetMonthlyPoints: true },
  });
  const capacityByKey = new Map<DeptKey, number>([["animations", 0], ["video-editing", 0]]);
  for (const w of onsiteWorkers) {
    const key: DeptKey = w.workerType === "ONSITE_ANIMATOR" ? "animations" : "video-editing";
    capacityByKey.set(key, (capacityByKey.get(key) ?? 0) + (w.targetMonthlyPoints ?? 0));
  }

  // Working days (per month config).
  const cfg = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { workingDays: true },
  });
  const workingDays = cfg?.workingDays ?? DEFAULT_WORKING_DAYS;
  const workingDaysAssumed = cfg?.workingDays == null;
  const daysRemaining = Math.max(0, workingDays - elapsedWorkingDays(monthKey, workingDays, now));

  // BD list (active BUSINESS_DEVELOPER + System BD), system first.
  const bdUsers = await prisma.user.findMany({
    where: { role: "BUSINESS_DEVELOPER" as any, archivedAt: null },
    orderBy: [{ fullName: "asc" }],
    select: { id: true, fullName: true, username: true, email: true },
  });
  const bds = bdUsers
    .map((b) => ({ id: b.id, name: b.fullName, isSystem: b.username === SYSTEM_BD_KEY || b.email === SYSTEM_BD_EMAIL }))
    .sort((a, b) => (a.isSystem === b.isSystem ? 0 : a.isSystem ? -1 : 1));

  // Allocation rows for the month, falling back to most recent prior month.
  const deptIds = DEPT_DEFS.map((d) => deptByKey.get(d.key)?.id).filter(Boolean) as string[];
  let allocRows = deptIds.length
    ? await prisma.bdDepartmentAllocation.findMany({
        where: { monthKey, departmentId: { in: deptIds } },
        select: { bdId: true, departmentId: true, sharePercent: true },
      })
    : [];
  let allocAssumed = false;
  let allocSourceMonth = monthKey;
  if (allocRows.length === 0 && deptIds.length) {
    const prior = await prisma.bdDepartmentAllocation.findFirst({
      where: { monthKey: { lt: monthKey }, departmentId: { in: deptIds } },
      orderBy: { monthKey: "desc" },
      select: { monthKey: true },
    });
    if (prior) {
      allocRows = await prisma.bdDepartmentAllocation.findMany({
        where: { monthKey: prior.monthKey, departmentId: { in: deptIds } },
        select: { bdId: true, departmentId: true, sharePercent: true },
      });
      allocAssumed = true;
      allocSourceMonth = prior.monthKey;
    }
  }
  const allocByBdDept = new Map<string, number>(); // `${bdId}:${deptId}` -> pct
  for (const r of allocRows) allocByBdDept.set(`${r.bdId}:${r.departmentId}`, num(r.sharePercent));

  // Pull onsite project finance for buckets, in the two departments.
  const projects = deptIds.length
    ? await prisma.project.findMany({
        where: {
          departmentId: { in: deptIds },
          finance: { isNot: null },
          OR: [
            { firstCompletedAt: { gte: start, lt: end } }, // achieved this month
            { firstCompletedAt: null, status: { in: ["IN_PROGRESS", "REVISION", "DELIVERED", "UNASSIGNED"] as any } },
          ],
        },
        select: {
          departmentId: true,
          status: true,
          firstCompletedAt: true,
          bdOwnerId: true,
          finance: { select: { priceUsd: true, workType: true } },
        },
      })
    : [];

  // Bucket accumulation keyed by deptId and (deptId,bdId).
  const deptBuckets = new Map<string, Buckets>();
  const bdBuckets = new Map<string, Buckets>(); // `${deptId}:${bdId}`
  const ensure = (m: Map<string, Buckets>, k: string) => {
    let b = m.get(k);
    if (!b) {
      b = { achievedUsd: 0, activeUsd: 0, backlogUsd: 0 };
      m.set(k, b);
    }
    return b;
  };

  for (const p of projects) {
    if (!p.departmentId || !p.finance) continue;
    const price = num(p.finance.priceUsd);
    if (price <= 0) continue;
    const isOnsite = p.finance.workType === "ONSITE";
    const isUnassigned = p.status === "UNASSIGNED";
    const inMonth = p.firstCompletedAt != null && p.firstCompletedAt >= start && p.firstCompletedAt < end;

    let field: keyof Buckets | null = null;
    if (inMonth && isOnsite) field = "achievedUsd"; // onsite achieved
    else if (!p.firstCompletedAt && isOnsite && (ACTIVE_STATUSES as readonly string[]).includes(p.status)) field = "activeUsd";
    else if (!p.firstCompletedAt && isUnassigned) field = "backlogUsd"; // backlog regardless of (undecided) workType
    if (!field) continue;

    ensure(deptBuckets, p.departmentId)[field] += price;
    const bdKey = `${p.departmentId}:${p.bdOwnerId ?? "none"}`;
    ensure(bdBuckets, bdKey)[field] += price;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Department results.
  const departments: DeptResult[] = DEPT_DEFS.map((def) => {
    const d = deptByKey.get(def.key);
    const capacityPoints = capacityByKey.get(def.key) ?? 0;
    const targetUsd = capacityPoints * DOLLARS_PER_POINT;
    const raw = (d && deptBuckets.get(d.id)) || { achievedUsd: 0, activeUsd: 0, backlogUsd: 0 };
    const buckets: Buckets = {
      achievedUsd: round2(raw.achievedUsd),
      activeUsd: round2(raw.activeUsd),
      backlogUsd: round2(raw.backlogUsd),
    };
    return {
      key: def.key,
      deptId: d?.id ?? null,
      name: def.name,
      capacityPoints,
      targetUsd: round2(targetUsd),
      workingDays,
      workingDaysAssumed,
      buckets,
      signals: buildSignals(targetUsd, buckets, workingDays, daysRemaining),
    };
  });

  // Per-BD results (slice each dept target by allocation %, coverage by bdOwnerId).
  const bdResults: BdResult[] = bds.map((bd) => {
    const perDept: BdDeptSlice[] = DEPT_DEFS.map((def) => {
      const d = deptByKey.get(def.key);
      const deptTarget = (capacityByKey.get(def.key) ?? 0) * DOLLARS_PER_POINT;
      const pct = d ? allocByBdDept.get(`${bd.id}:${d.id}`) ?? 0 : 0;
      const targetUsd = round2((deptTarget * pct) / 100);
      const raw = (d && bdBuckets.get(`${d.id}:${bd.id}`)) || { achievedUsd: 0, activeUsd: 0, backlogUsd: 0 };
      const buckets: Buckets = {
        achievedUsd: round2(raw.achievedUsd),
        activeUsd: round2(raw.activeUsd),
        backlogUsd: round2(raw.backlogUsd),
      };
      const bdWorkingDays = workingDays; // same calendar
      return {
        key: def.key,
        name: def.name,
        allocationPct: pct,
        allocationAssumed: allocAssumed,
        targetUsd,
        buckets,
        signals: buildSignals(targetUsd, buckets, bdWorkingDays, daysRemaining),
      };
    });
    const totalTargetUsd = round2(perDept.reduce((s, x) => s + x.targetUsd, 0));
    const totalCoveredUsd = round2(perDept.reduce((s, x) => s + x.signals.coveredUsd, 0));
    return {
      bdId: bd.id,
      name: bd.name,
      isSystem: bd.isSystem,
      perDept,
      totalTargetUsd,
      totalCoveredUsd,
      totalGapUsd: round2(totalTargetUsd - totalCoveredUsd),
    };
  });

  // Company totals.
  const totals = departments.reduce(
    (acc, d) => {
      acc.targetUsd += d.targetUsd;
      acc.achievedUsd += d.buckets.achievedUsd;
      acc.activeUsd += d.buckets.activeUsd;
      acc.backlogUsd += d.buckets.backlogUsd;
      return acc;
    },
    { targetUsd: 0, achievedUsd: 0, activeUsd: 0, backlogUsd: 0, gapUsd: 0 }
  );
  totals.targetUsd = round2(totals.targetUsd);
  totals.achievedUsd = round2(totals.achievedUsd);
  totals.activeUsd = round2(totals.activeUsd);
  totals.backlogUsd = round2(totals.backlogUsd);
  totals.gapUsd = round2(totals.targetUsd - (totals.achievedUsd + totals.activeUsd + totals.backlogUsd));

  // Expose allocation provenance via a synthetic flag on departments (cheap).
  void allocSourceMonth;

  return {
    monthKey,
    fx,
    fxMonthKey,
    fxAssumed,
    setupComplete,
    departments,
    bds: bdResults,
    totals,
  };
}
