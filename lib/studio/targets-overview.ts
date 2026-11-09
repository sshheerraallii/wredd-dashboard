import { getPrisma } from "@/lib/prisma";
import { SYSTEM_BD_EMAIL, SYSTEM_BD_KEY } from "@/lib/bd-commission/constants";
import { ACTIVE_STATUSES, DEFAULT_WORKING_DAYS } from "@/lib/bd-targets/constants";
import type {
  BdResult,
  Buckets,
  DeptResult,
  SignalSet,
  TargetsComputation,
} from "@/lib/bd-targets/compute";

/**
 * Targets overview for a STUDIO month.
 *
 * Same output shape as the STAFF overview so every page and card keeps working,
 * but with one "All work" bucket instead of the two capacity departments:
 *   target   = each BD's USD target (company = sum)
 *   achieved = gross USD of projects first completed this month — any
 *              department, any work type (in-house, remote, onsite)
 *   active   = not yet completed, in progress / delivered / revision
 *   backlog  = unassigned
 */

const prisma = getPrisma();

function num(v: unknown): number {
  const n = Number((v as { toString?: () => string })?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const BASIS = "BD targets (USD)";

type Deps = {
  monthBoundsUTC: (mk: string) => { start: Date; end: Date };
  elapsedWorkingDays: (mk: string, workingDays: number, now: Date) => number;
  resolveFx: (mk: string) => Promise<{ fx: number; fxMonthKey: string | null; assumed: boolean }>;
  buildSignals: (target: number, b: Buckets, workingDays: number, daysRemaining: number) => SignalSet;
};

export async function computeStudioTargets(
  monthKey: string,
  now: Date,
  deps: Deps
): Promise<TargetsComputation> {
  const { start, end } = deps.monthBoundsUTC(monthKey);
  const { fx, fxMonthKey, assumed: fxAssumed } = await deps.resolveFx(monthKey);

  const cfg = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { workingDays: true },
  });
  const workingDays = cfg?.workingDays ?? DEFAULT_WORKING_DAYS;
  const workingDaysAssumed = cfg?.workingDays == null;
  const daysRemaining = Math.max(0, workingDays - deps.elapsedWorkingDays(monthKey, workingDays, now));

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

  const targets = await prisma.bdMonthTarget.findMany({
    where: { monthKey },
    select: { bdId: true, targetUsd: true },
  });
  const targetBy = new Map(targets.map((t) => [t.bdId, num(t.targetUsd)]));
  const totalTarget = targets.reduce((a, t) => a + num(t.targetUsd), 0);

  const projects = await prisma.project.findMany({
    where: {
      isSample: false,
      finance: { isNot: null },
      OR: [
        { firstCompletedAt: { gte: start, lt: end } },
        {
          firstCompletedAt: null,
          status: { in: ["IN_PROGRESS", "REVISION", "DELIVERED", "UNASSIGNED"] as any },
        },
      ],
    },
    select: {
      status: true,
      firstCompletedAt: true,
      bdOwnerId: true,
      finance: { select: { priceUsd: true } },
    },
  });

  const empty = (): Buckets => ({ achievedUsd: 0, activeUsd: 0, backlogUsd: 0 });
  const company = empty();
  const byBd = new Map<string, Buckets>();

  for (const p of projects) {
    const price = num(p.finance?.priceUsd);
    if (price <= 0) continue;
    const inMonth = p.firstCompletedAt != null && p.firstCompletedAt >= start && p.firstCompletedAt < end;
    let field: keyof Buckets | null = null;
    if (inMonth) field = "achievedUsd";
    else if (!p.firstCompletedAt && (ACTIVE_STATUSES as readonly string[]).includes(String(p.status)))
      field = "activeUsd";
    else if (!p.firstCompletedAt && String(p.status) === "UNASSIGNED") field = "backlogUsd";
    if (!field) continue;

    company[field] += price;
    const key = p.bdOwnerId ?? "none";
    const b = byBd.get(key) ?? empty();
    b[field] += price;
    byBd.set(key, b);
  }

  const round = (b: Buckets): Buckets => ({
    achievedUsd: r2(b.achievedUsd),
    activeUsd: r2(b.activeUsd),
    backlogUsd: r2(b.backlogUsd),
  });

  const companyBuckets = round(company);
  const allWork: DeptResult = {
    key: "all",
    deptId: null,
    name: "All work",
    capacityPoints: 0,
    targetUsd: r2(totalTarget),
    workingDays,
    workingDaysAssumed,
    buckets: companyBuckets,
    signals: deps.buildSignals(totalTarget, companyBuckets, workingDays, daysRemaining),
    basisLabel: BASIS,
  };

  const bdResults: BdResult[] = bds.map((bd) => {
    const t = targetBy.get(bd.id) ?? 0;
    const buckets = round(byBd.get(bd.id) ?? empty());
    const signals = deps.buildSignals(t, buckets, workingDays, daysRemaining);
    return {
      bdId: bd.id,
      name: bd.name,
      isSystem: bd.isSystem,
      perDept: [
        {
          key: "all",
          name: "All work",
          allocationPct: totalTarget > 0 ? r2((t / totalTarget) * 100) : 0,
          allocationAssumed: false,
          targetUsd: r2(t),
          buckets,
          signals,
          basisLabel: BASIS,
        },
      ],
      totalTargetUsd: r2(t),
      totalCoveredUsd: signals.coveredUsd,
      totalGapUsd: r2(t - signals.coveredUsd),
    };
  });

  const covered = companyBuckets.achievedUsd + companyBuckets.activeUsd + companyBuckets.backlogUsd;

  return {
    monthKey,
    model: "STUDIO",
    fx,
    fxMonthKey,
    fxAssumed,
    setupComplete: true,
    departments: [allWork],
    bds: bdResults,
    totals: {
      targetUsd: r2(totalTarget),
      achievedUsd: companyBuckets.achievedUsd,
      activeUsd: companyBuckets.activeUsd,
      backlogUsd: companyBuckets.backlogUsd,
      gapUsd: r2(totalTarget - covered),
    },
  };
}
