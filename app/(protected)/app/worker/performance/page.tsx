// app/(protected)/app/worker/performance/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { MonthRangeFilter } from "./_components/month-range-filter";
import { MonthGroups, type MonthGroup } from "./_components/month-groups";
import { getWorkerAssignmentStats } from "@/lib/worker-stats/assignments";
import { computeCommitmentIndex } from "@/lib/worker-stats/commitment-index";
import { CommitmentIndexCard } from "@/components/app/commitment-index";
import { getUserEstimatedPoints } from "@/lib/onsite-points/aggregate";
import { EstimatedPointsPanel } from "@/components/app/estimated-points-panel";
import { sumManualForUser, sumManualByMonth } from "@/lib/onsite-points/manual";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

type Period = "monthly" | "overall";

function parsePeriod(input?: string): Period {
  const p = (input || "").toLowerCase();
  return p === "overall" ? "overall" : "monthly";
}

function parsePage(input: string | undefined) {
  const n = Number(input || "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function monthKeyOf(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthRange(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function monthRangeFromKey(monthKey: string) {
  const [ys, ms] = monthKey.split("-");
  const y = Number(ys);
  const m = Number(ms) - 1;
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function pct(n: number, d: number) {
  if (!d || d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function avg(nums: number[]) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function money(s: string) {
  return s || "0";
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Count Mon–Fri days between two dates (both inclusive).
 */
function countWorkingDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Returns the pro-rated monthly target for a given month.
 *
 * - Current month → pro-rated by working days elapsed (Mon–Fri) ÷ 25.
 *   This stops the accuracy from tanking at the start of a month.
 * - Past months → pro-rated by calendar days (only matters if the worker
 *   joined mid-month; fully-worked months return the full target).
 * - Join-date guard: if the worker joined after this month ends, returns 0.
 */
function proratedMonthlyTarget(params: {
  targetMonthlyPoints: number;
  joinedAt: Date;
  monthKey: string;
}): number {
  const base = params.targetMonthlyPoints ?? 0;
  if (base <= 0) return 0;

  const { start, end } = monthRangeFromKey(params.monthKey);
  const now = new Date();
  const currentMonthKey = monthKeyOf(now);
  const isCurrentMonth = params.monthKey === currentMonthKey;

  // Effective start = later of month start or joinedAt
  const joinDay = startOfDay(params.joinedAt);
  if (joinDay >= end) return 0; // joined after this month entirely

  const effectiveStart = joinDay > start ? joinDay : start;

  if (isCurrentMonth) {
    // Pro-rate by working days elapsed so far — prevents unfair 1% on June 2nd.
    // Target is defined for 25 working days.
    const todayStart = startOfDay(now);
    if (todayStart < effectiveStart) return 0; // joined after today
    const elapsed = countWorkingDays(effectiveStart, todayStart);
    if (elapsed === 0) return 0; // first day of the month and it's a weekend
    return (base * elapsed) / 25;
  }

  // Past month — use calendar-day pro-rating (only differs when joined mid-month)
  if (joinDay <= start) return base;
  const totalDays = daysInMonth(start);
  const dayIndex = joinDay.getDate();
  const remainingDaysInclusive = totalDays - dayIndex + 1;
  return base * (remainingDaysInclusive / totalDays);
}

function listMonthKeysInclusive(startMonth: Date, endDate: Date) {
  const out: string[] = [];
  const s = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  const e = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  const cur = new Date(s);
  while (cur <= e) {
    out.push(monthKeyOf(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function inMonthKeyRange(mk: string, from?: string, to?: string) {
  if (from && mk < from) return false;
  if (to && mk > to) return false;
  return true;
}

function PeriodSwitch({ period }: { period: Period }) {
  return (
    <div className="flex gap-2">
      <Link
        href={`/app/worker/performance?period=monthly`}
        className={[
          "rounded-full border px-3 py-1 text-sm",
          period === "monthly"
            ? "bg-primary text-primary-foreground border-primary"
            : "hover:bg-muted",
        ].join(" ")}
      >
        Monthly
      </Link>
      <Link
        href={`/app/worker/performance?period=overall`}
        className={[
          "rounded-full border px-3 py-1 text-sm",
          period === "overall"
            ? "bg-primary text-primary-foreground border-primary"
            : "hover:bg-muted",
        ].join(" ")}
      >
        Overall
      </Link>
    </div>
  );
}

function lastNMonthKeys(n: number, now: Date) {
  const out: { key: string; start: Date; end: Date }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKeyOf(d);
    const { start, end } = monthRange(d);
    out.push({ key, start, end });
  }
  return out;
}

function MonthsPagination(props: {
  period: Period;
  from: string;
  to: string;
  page: number;
  total: number;
  pageSize: number;
}) {
  const { period, from, to, page, total, pageSize } = props;
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  const build = (p: number) => {
    const params = new URLSearchParams();
    params.set("period", period);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("mPage", String(p));
    return `/app/worker/performance?${params.toString()}`;
  };

  const fromRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-muted-foreground">
        Page {page} • Showing {fromRow}-{toRow} of {total} months
      </div>
      <div className="flex gap-2">
        {hasPrev ? (
          <Button asChild variant="secondary">
            <Link href={build(page - 1)}>Prev</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled>Prev</Button>
        )}
        {hasNext ? (
          <Button asChild variant="secondary">
            <Link href={build(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled>Next</Button>
        )}
      </div>
    </div>
  );
}

async function loadMonthlyProjectsForWorker(params: {
  userId: string;
  monthStart: Date;
  monthEnd: Date;
}) {
  const { userId, monthStart, monthEnd } = params;

  const projects = await prisma.project.findMany({
    where: {
      assignments: { some: { userId } },
      OR: [
        { status: { in: ["IN_PROGRESS", "DELIVERED", "REVISION"] } },
        { status: "COMPLETED", firstCompletedAt: { gte: monthStart, lt: monthEnd } },
        {
          status: "CANCELLED",
          OR: [
            { cancelledAt: { gte: monthStart, lt: monthEnd } },
            { cancelledAt: null, updatedAt: { gte: monthStart, lt: monthEnd } },
          ],
        },
        {
          assignments: {
            some: {
              userId,
              outcome: "CANCELLED" as any,
              cancelledForWorkerAt: { gte: monthStart, lt: monthEnd },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      deadlineHours: true,
      cancelledAt: true,
      firstCompletedAt: true,
      statusChangedAt: true,
      updatedAt: true,
      assignments: {
        where: { userId },
        select: { outcome: true, cancelledForWorkerAt: true },
        take: 1,
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 2000,
  });

  const byStatus: Record<string, typeof projects> = {};
  for (const p of projects) {
    const key = p.status;
    if (!byStatus[key]) byStatus[key] = [];
    byStatus[key].push(p);
  }

  const order = ["IN_PROGRESS", "DELIVERED", "REVISION", "COMPLETED", "CANCELLED"];
  return { projects, byStatus, order };
}

function effectiveMonthKeyForProject(p: {
  cancelledAt: Date | null;
  firstCompletedAt: Date | null;
  statusChangedAt: Date | null;
  updatedAt: Date;
}) {
  const d =
    p.cancelledAt ??
    p.firstCompletedAt ??
    p.statusChangedAt ??
    p.updatedAt ??
    new Date();
  return monthKeyOf(new Date(d));
}

export default async function WorkerPerformancePage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string; mPage?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const userId = session.user.id;

  const isOnsite = role === "ONSITE_EMPLOYEE";
  const isRemote = role === "REMOTE_WORKER";
  if (!isOnsite && !isRemote) redirect("/app?err=forbidden");

  const period = parsePeriod(searchParams?.period);

  const now = new Date();
  const mk = monthKeyOf(now);
  const { start: monthStart, end: monthEnd } = monthRange(now);

  const fromKey = (searchParams?.from || "").trim();
  const toKey = (searchParams?.to || "").trim();
  const mPage = parsePage(searchParams?.mPage);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      workerType: true,
      role: true,
      targetMonthlyPoints: true,
      joinedAt: true,
    },
  });

  if (!me) redirect("/login");
  if (!me.joinedAt) redirect("/app?err=joinedAt_missing");

  // Commitment Index — computed once, used in both onsite + remote views
  const workerStats = await getWorkerAssignmentStats(userId);
  const commitmentIndex = computeCommitmentIndex(workerStats);

  const monthlyList =
    period === "monthly"
      ? await loadMonthlyProjectsForWorker({ userId, monthStart, monthEnd })
      : null;



const completed =
    period === "overall"
      ? await prisma.projectAssignment.count({
          where: { userId, outcome: "COMPLETED" as any },
        })
      : await prisma.projectAssignment.count({
          where: {
            userId,
            outcome: "COMPLETED" as any,
            project: { firstCompletedAt: { gte: monthStart, lt: monthEnd } },
          },
        });

  const [cancelledForWorker, projectCancelledWhileAssigned] = await Promise.all([
    prisma.projectAssignment.count({
      where:
        period === "overall"
          ? { userId, outcome: "CANCELLED" as any }
          : { userId, outcome: "CANCELLED" as any, cancelledForWorkerAt: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.projectAssignment.count({
      where:
        period === "overall"
          ? { userId, unassignedAt: null, project: { status: "CANCELLED" } }
          : {
              userId,
              unassignedAt: null,
              project: { status: "CANCELLED", cancelledAt: { gte: monthStart, lt: monthEnd } },
            },
    }),
  ]);

  const cancelled = cancelledForWorker + projectCancelledWhileAssigned;




        

  const completionRate = pct(completed, completed + cancelled);

  const months = lastNMonthKeys(6, now);

  // ── ONSITE WORKER ─────────────────────────────────────────────────────────
  if (isOnsite) {
    const ratingAvg = await (async () => {
      const credits = await prisma.onsitePointCredit.findMany({
        where: { userId, ...(period === "monthly" ? { monthKey: mk } : {}) },
        select: {
          project: {
            select: {
              onsiteRating: { select: { m1: true, m2: true, m3: true, m4: true, m5: true } },
            },
          },
        },
        take: 5000,
      });
      const perProject = credits
        .map((c) => c.project.onsiteRating)
        .filter(Boolean)
        .map((r: any) => (r.m1 + r.m2 + r.m3 + r.m4 + r.m5) / 5);
      return avg(perProject);
    })();

    const pts = await (async () => {
      const agg = await prisma.onsitePointCredit.aggregate({
        where: { userId, ...(period === "monthly" ? { monthKey: mk } : {}) },
        _sum: { points: true },
        _count: { _all: true },
      });
      const manual = await sumManualForUser(userId, {
        ...(period === "monthly" ? { monthKey: mk } : {}),
      });
      const projectPoints = agg._sum.points ?? 0;
      return {
        achievedPoints: projectPoints + manual,
        projectPoints,
        manualPoints: manual,
        creditedProjects: agg._count._all ?? 0,
      };
    })();

    let accuracy: number | null = null;
    if (period === "monthly") {
      const t = proratedMonthlyTarget({
        targetMonthlyPoints: me.targetMonthlyPoints,
        joinedAt: me.joinedAt,
        monthKey: mk,
      });
      accuracy = t > 0 ? Math.round((pts.achievedPoints / t) * 100) : null;
    } else {
      const startMonth = new Date(me.joinedAt.getFullYear(), me.joinedAt.getMonth(), 1);
      const thisMonthKey = monthKeyOf(now);
      const monthKeys = listMonthKeysInclusive(startMonth, now).filter(
        (k) => k !== thisMonthKey
      );
      const credits = await prisma.onsitePointCredit.findMany({
        where: { userId },
        select: { monthKey: true, points: true },
        take: 100000,
      });
      const sums: Record<string, number> = {};
      for (const c of credits) sums[c.monthKey] = (sums[c.monthKey] ?? 0) + c.points;

      // Fold in manual ± points per month (manual-only month counts as activity).
      const manualByMonth = await sumManualByMonth(userId, monthKeys);
      for (const [k, v] of manualByMonth) sums[k] = (sums[k] ?? 0) + v;

      // ✅ Only include months where the worker actually had activity.
      // Months with no activity (no credits and no manual) are excluded from
      // the average — it's unfair to count a month where nothing happened.
      const monthsWithActivity = new Set(Object.keys(sums));

      const accuracies: number[] = [];
      for (const k of monthKeys) {
        if (!monthsWithActivity.has(k)) continue; // skip months with no credited projects
        const achieved = sums[k] ?? 0;
        const target = proratedMonthlyTarget({
          targetMonthlyPoints: me.targetMonthlyPoints,
          joinedAt: me.joinedAt,
          monthKey: k,
        });
        if (!target || target <= 0) continue;
        accuracies.push((achieved / target) * 100);
      }
      const a = avg(accuracies);
      accuracy = a != null ? Math.round(a) : null;
    }

    const creditRows = await prisma.onsitePointCredit.findMany({
      where: { userId },
      select: {
        monthKey: true,
        points: true,
        project: {
          select: {
            onsiteRating: { select: { m1: true, m2: true, m3: true, m4: true, m5: true } },
          },
        },
      },
      take: 10000,
    });

    const grouped: Record<string, { points: number; ratings: number[] }> = {};
    for (const r of creditRows) {
      if (!grouped[r.monthKey]) grouped[r.monthKey] = { points: 0, ratings: [] };
      grouped[r.monthKey].points += r.points;
      const or = r.project.onsiteRating as any;
      if (or)
        grouped[r.monthKey].ratings.push((or.m1 + or.m2 + or.m3 + or.m4 + or.m5) / 5);
    }

    // Fold manual ± points into each displayed month (incl. manual-only months).
    const histManualByMonth = await sumManualByMonth(
      userId,
      months.map((m) => m.key)
    );
    for (const [k, v] of histManualByMonth) {
      if (!grouped[k]) grouped[k] = { points: 0, ratings: [] };
      grouped[k].points += v;
    }

    const history = months.map((m) => {
      const g = grouped[m.key];
      const achieved = g?.points ?? 0;
      const hasActivity = !!g && achieved > 0;
      const avgRating = g?.ratings?.length ? avg(g.ratings) : null;
      const t = proratedMonthlyTarget({
        targetMonthlyPoints: me.targetMonthlyPoints,
        joinedAt: me.joinedAt,
        monthKey: m.key,
      });
      // Only show accuracy for months with actual credited projects
      const acc = hasActivity && t > 0 ? Math.round((achieved / t) * 100) : null;
      return { monthKey: m.key, achievedPoints: achieved, accuracy: acc, avgRating, hasActivity };
    });

    let allMonthKeys: string[] = [];
    let monthGroups: MonthGroup[] = [];
    let totalMonths = 0;
    const MONTHS_PER_PAGE = 6;

    if (period === "overall") {
      const distinct = await prisma.onsitePointCredit.findMany({
        where: { userId },
        select: { monthKey: true },
        distinct: ["monthKey"],
        orderBy: { monthKey: "desc" },
        take: 5000,
      });
      allMonthKeys = distinct.map((r) => r.monthKey);
      const filteredKeys = allMonthKeys.filter((k) =>
        inMonthKeyRange(k, fromKey || undefined, toKey || undefined)
      );
      totalMonths = filteredKeys.length;
      const safePage = Math.max(
        1,
        Math.min(mPage, Math.max(1, Math.ceil(totalMonths / MONTHS_PER_PAGE)))
      );
      const pageKeys = filteredKeys.slice(
        (safePage - 1) * MONTHS_PER_PAGE,
        safePage * MONTHS_PER_PAGE
      );

      if (pageKeys.length) {
        const rows = await prisma.onsitePointCredit.findMany({
          where: { userId, monthKey: { in: pageKeys } },
          select: {
            monthKey: true,
            points: true,
            project: {
              select: {
                id: true,
                title: true,
                status: true,
                onsiteRating: {
                  select: { m1: true, m2: true, m3: true, m4: true, m5: true },
                },
              },
            },
          },
          take: 20000,
        });

        const map: Record<
          string,
          {
            totalPoints: number;
            ratings: number[];
            rows: {
              projectId: string;
              title: string;
              status: string;
              rating: number | null;
              points: number;
            }[];
          }
        > = {};

        for (const r of rows) {
          const k = r.monthKey;
          if (!map[k]) map[k] = { totalPoints: 0, ratings: [], rows: [] };
          map[k].totalPoints += r.points;
          const or: any = r.project?.onsiteRating;
          const rating = or ? (or.m1 + or.m2 + or.m3 + or.m4 + or.m5) / 5 : null;
          if (rating != null) map[k].ratings.push(rating);
          map[k].rows.push({
            projectId: r.project.id,
            title: r.project.title,
            status: r.project.status,
            rating,
            points: r.points,
          });
        }

        monthGroups = pageKeys.map((k) => {
          const g = map[k] ?? { totalPoints: 0, ratings: [], rows: [] };
          const avgRating = g.ratings.length ? avg(g.ratings) : null;
          const t = proratedMonthlyTarget({
            targetMonthlyPoints: me.targetMonthlyPoints,
            joinedAt: me.joinedAt,
            monthKey: k,
          });
          const acc = t > 0 ? Math.round((g.totalPoints / t) * 100) : null;
          return {
            monthKey: k,
            totalPoints: g.totalPoints,
            accuracy: acc,
            avgRating,
            rows: g.rows,
          };
        });
      }
    }

    const estimatedSummary = await getUserEstimatedPoints(userId);

    return (
      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">My Performance</h1>
            <p className="text-sm text-muted-foreground">
              Onsite • {me.fullName} • {me.workerType || "—"}
            </p>
          </div>
          <PeriodSwitch period={period} />
        </div>

        {/* Commitment Index */}
        <CommitmentIndexCard
          index={commitmentIndex}
          showCancellationDetail={false}
        />

        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Completion Rate</div>
            <div className="mt-1 text-2xl font-semibold">{completionRate}%</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Completed {completed} • Cancelled {cancelled} (
              {period === "monthly" ? mk : "all-time"})
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Avg Onsite Rating</div>
            <div className="mt-1 text-2xl font-semibold">
              {ratingAvg != null ? ratingAvg.toFixed(1) : "—"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              From onsite project ratings ({period === "monthly" ? mk : "all-time"})
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Finalized Points</div>
            <div className="mt-1 text-2xl font-semibold">{pts.achievedPoints}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Accuracy: {accuracy != null ? `${accuracy}%` : "—"} • Target{" "}
              {period === "monthly"
                ? "prorated monthly"
                : "avg of monthly accuracies (prorated)"}
            </div>
            {pts.manualPoints ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Includes {pts.manualPoints > 0 ? "+" : "−"}
                {Math.abs(pts.manualPoints)} manual point
                {Math.abs(pts.manualPoints) === 1 ? "" : "s"} ({pts.projectPoints} from projects)
              </div>
            ) : null}
          </div>
        </div>

        {/* Live estimated layer — only meaningful for active projects right now */}
        <EstimatedPointsPanel summary={estimatedSummary} />

        {period === "monthly" ? (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">This month projects</div>
                <div className="text-xs text-muted-foreground">{mk}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                Total: {monthlyList?.projects.length ?? 0}
              </div>
            </div>

            {monthlyList?.projects.length ? (
              <div className="space-y-4">
                {monthlyList.order.map((st) => {
                  const rows = monthlyList.byStatus[st] || [];
                  if (!rows.length) return null;
                  return (
                    <div key={st} className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        {st} • {rows.length}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-xs text-muted-foreground">
                            <tr className="border-b">
                              <th className="py-2 text-left">Project</th>
                              <th className="py-2 text-right">Status</th>
                              <th className="py-2 text-right">Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((p) => {
                              const myA: any = (p as any).assignments?.[0] ?? null;
                              const stLabel =
                                myA?.outcome === "CANCELLED"
                                  ? "CANCELLED (for you)"
                                  : p.status;
                              return (
                                <tr key={p.id} className="border-b last:border-b-0">
                                  <td className="py-2">
                                    <Link
                                      href={`/app/projects/${p.id}`}
                                      className="hover:underline"
                                    >
                                      {p.title}
                                    </Link>
                                  </td>
                                  <td className="py-2 text-right">{stLabel}</td>
                                  <td className="py-2 text-right text-xs text-muted-foreground">
                                    {new Date(p.updatedAt).toLocaleDateString()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No projects for this month yet.
              </div>
            )}
          </div>
        ) : null}

        {period === "overall" ? (
          <div className="space-y-3">
            <MonthRangeFilter monthKeys={allMonthKeys} />
            <MonthsPagination
              period="overall"
              from={fromKey}
              to={toKey}
              page={mPage}
              total={totalMonths}
              pageSize={MONTHS_PER_PAGE}
            />
            <MonthGroups groups={monthGroups} />
            <MonthsPagination
              period="overall"
              from={fromKey}
              to={toKey}
              page={mPage}
              total={totalMonths}
              pageSize={MONTHS_PER_PAGE}
            />
          </div>
        ) : null}

        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-medium">Last 6 months</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left">Month</th>
                  <th className="py-2 text-right">Points</th>
                  <th className="py-2 text-right">Accuracy</th>
                  <th className="py-2 text-right">Avg Rating</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.monthKey} className="border-b last:border-b-0">
                    <td className="py-2">{h.monthKey}</td>
                    <td className="py-2 text-right">{h.achievedPoints}</td>
                    <td className="py-2 text-right">
                      {h.accuracy != null ? `${h.accuracy}%` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {h.avgRating != null ? h.avgRating.toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── REMOTE WORKER ─────────────────────────────────────────────────────────

  const ratingAvg = await (async () => {
    const rows = await prisma.projectAssignment.findMany({
      where: {
        userId,
        project: {
          rating: {
            is:
              period === "monthly"
                ? { ratedAt: { gte: monthStart, lt: monthEnd } }
                : {},
          },
        },
      },
      select: {
        project: {
          select: {
            rating: {
              select: {
                communication: true,
                quality: true,
                speed: true,
                professionalism: true,
              },
            },
          },
        },
      },
      take: 5000,
    });

    const perProject = rows
      .map((r) => r.project.rating)
      .filter(Boolean)
      .map((rt: any) => {
        const nums = [rt.communication, rt.quality, rt.speed].concat(
          rt.professionalism != null ? [rt.professionalism] : []
        );
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      });

    return avg(perProject);
  })();

  const earnings = await (async () => {
    const whereBase: any = {
      userId,
      ...(period === "monthly" ? { payableOn: { gte: monthStart, lt: monthEnd } } : {}),
    };

    const paid = await prisma.projectPaymentLine.aggregate({
      where: { ...whereBase, status: { in: ["PAID", "EXCEPTION_PAID"] } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const unpaid = await prisma.projectPaymentLine.aggregate({
      where: { ...whereBase, status: "UNPAID" },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return {
      paidAmount: paid._sum.amount?.toString() ?? "0",
      paidCount: paid._count._all ?? 0,
      unpaidAmount: unpaid._sum.amount?.toString() ?? "0",
      unpaidCount: unpaid._count._all ?? 0,
    };
  })();

  let remoteAllMonthKeys: string[] = [];
  let remotePageKeys: string[] = [];
  let remoteTotalMonths = 0;
  const REMOTE_MONTHS_PER_PAGE = 6;

  type RemoteRow = {
    projectId: string;
    title: string;
    status: string;
    rating: number | null;
    paid: number;
    unpaid: number;
  };

  let remoteMonthMap: Record<
    string,
    { rows: RemoteRow[]; avgRating: number | null; paidTotal: number; unpaidTotal: number }
  > = {};

  if (period === "overall") {
    const projects = await prisma.project.findMany({
      where: { assignments: { some: { userId } } },
      select: {
        id: true,
        title: true,
        status: true,
        cancelledAt: true,
        firstCompletedAt: true,
        statusChangedAt: true,
        updatedAt: true,
        rating: {
          select: {
            ratedAt: true,
            communication: true,
            quality: true,
            speed: true,
            professionalism: true,
          },
        },
        paymentLines: {
          where: { userId },
          select: { amount: true, status: true },
          take: 2000,
        },
      },
      take: 5000,
      orderBy: { updatedAt: "desc" },
    });

    const keys = new Set<string>();
    for (const p of projects) {
      keys.add(
        effectiveMonthKeyForProject({
          cancelledAt: p.cancelledAt,
          firstCompletedAt: p.firstCompletedAt,
          statusChangedAt: p.statusChangedAt,
          updatedAt: p.updatedAt,
        })
      );
    }
    remoteAllMonthKeys = Array.from(keys).sort((a, b) => (a > b ? -1 : 1));

    const filtered = remoteAllMonthKeys.filter((k) =>
      inMonthKeyRange(k, fromKey || undefined, toKey || undefined)
    );
    remoteTotalMonths = filtered.length;

    const safePage = Math.max(
      1,
      Math.min(mPage, Math.max(1, Math.ceil(remoteTotalMonths / REMOTE_MONTHS_PER_PAGE)))
    );
    remotePageKeys = filtered.slice(
      (safePage - 1) * REMOTE_MONTHS_PER_PAGE,
      safePage * REMOTE_MONTHS_PER_PAGE
    );

    const want = new Set(remotePageKeys);
    for (const p of projects) {
      const k = effectiveMonthKeyForProject({
        cancelledAt: p.cancelledAt,
        firstCompletedAt: p.firstCompletedAt,
        statusChangedAt: p.statusChangedAt,
        updatedAt: p.updatedAt,
      });
      if (!want.has(k)) continue;
      if (!remoteMonthMap[k]) {
        remoteMonthMap[k] = { rows: [], avgRating: null, paidTotal: 0, unpaidTotal: 0 };
      }

      const rt: any = p.rating;
      const rating =
        rt
          ? (() => {
              const nums = [rt.communication, rt.quality, rt.speed].concat(
                rt.professionalism != null ? [rt.professionalism] : []
              );
              return nums.reduce((a: number, b: number) => a + b, 0) / nums.length;
            })()
          : null;

      let paid = 0;
      let unpaid = 0;
      for (const l of p.paymentLines) {
        const amt = Number(l.amount.toString());
        if (l.status === "PAID" || l.status === "EXCEPTION_PAID") paid += amt;
        if (l.status === "UNPAID") unpaid += amt;
      }

      remoteMonthMap[k].paidTotal += paid;
      remoteMonthMap[k].unpaidTotal += unpaid;
      remoteMonthMap[k].rows.push({
        projectId: p.id,
        title: p.title,
        status: p.status,
        rating,
        paid,
        unpaid,
      });
    }

    for (const k of Object.keys(remoteMonthMap)) {
      const rs = remoteMonthMap[k].rows
        .map((r) => r.rating)
        .filter((x): x is number => x != null);
      remoteMonthMap[k].avgRating = rs.length ? avg(rs) : null;
    }
  }

  const lines = await prisma.projectPaymentLine.findMany({
    where: { userId },
    select: { payableOn: true, amount: true, status: true },
    take: 20000,
  });

  const ratedRows = await prisma.projectAssignment.findMany({
    where: { userId, project: { rating: { isNot: null } } },
    select: {
      project: {
        select: {
          rating: {
            select: {
              ratedAt: true,
              communication: true,
              quality: true,
              speed: true,
              professionalism: true,
            },
          },
        },
      },
    },
    take: 10000,
  });

  const lineGrouped: Record<
    string,
    { paid: number; unpaid: number; paidCount: number; unpaidCount: number }
  > = {};
for (const l of lines) {
    if (!l.payableOn) continue;
    const k = monthKeyOf(new Date(l.payableOn));
    if (!lineGrouped[k]) lineGrouped[k] = { paid: 0, unpaid: 0, paidCount: 0, unpaidCount: 0 };
    const amt = Number(l.amount.toString());
    if (l.status === "PAID" || l.status === "EXCEPTION_PAID") {
      lineGrouped[k].paid += amt;
      lineGrouped[k].paidCount += 1;
    } else if (l.status === "UNPAID") {
      lineGrouped[k].unpaid += amt;
      lineGrouped[k].unpaidCount += 1;
    }
  }

  const ratingGrouped: Record<string, number[]> = {};
  for (const r of ratedRows) {
    const rt: any = r.project.rating;
    if (!rt) continue;
    const k = monthKeyOf(new Date(rt.ratedAt));
    if (!ratingGrouped[k]) ratingGrouped[k] = [];
    const nums = [rt.communication, rt.quality, rt.speed].concat(
      rt.professionalism != null ? [rt.professionalism] : []
    );
    ratingGrouped[k].push(nums.reduce((a: number, b: number) => a + b, 0) / nums.length);
  }

  const history = months.map((m) => {
    const g = lineGrouped[m.key] || { paid: 0, unpaid: 0, paidCount: 0, unpaidCount: 0 };
    const ra = ratingGrouped[m.key]?.length ? avg(ratingGrouped[m.key]!) : null;
    return { monthKey: m.key, ...g, ratingAvg: ra };
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My Performance</h1>
          <p className="text-sm text-muted-foreground">
            Remote • {me.fullName} • {me.workerType || "—"}
          </p>
        </div>
        <PeriodSwitch period={period} />
      </div>

      {/* Commitment Index */}
      <CommitmentIndexCard
        index={commitmentIndex}
        showCancellationDetail={false}
      />

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Completion Rate</div>
          <div className="mt-1 text-2xl font-semibold">{completionRate}%</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Completed {completed} • Cancelled {cancelled} (
            {period === "monthly" ? mk : "all-time"})
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Avg Project Rating</div>
          <div className="mt-1 text-2xl font-semibold">
            {ratingAvg != null ? ratingAvg.toFixed(1) : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            From BD project ratings ({period === "monthly" ? mk : "all-time"})
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Earnings</div>
          <div className="mt-2 text-sm">
            Paid: <span className="font-medium">{money(earnings.paidAmount)}</span> (
            {earnings.paidCount})
          </div>
          <div className="mt-1 text-sm">
            Unpaid: <span className="font-medium">{money(earnings.unpaidAmount)}</span> (
            {earnings.unpaidCount})
          </div>
        </div>
      </div>

      {period === "monthly" ? (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">This month projects</div>
              <div className="text-xs text-muted-foreground">{mk}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              Total: {monthlyList?.projects.length ?? 0}
            </div>
          </div>

          {monthlyList?.projects.length ? (
            <div className="space-y-4">
              {monthlyList.order.map((st) => {
                const rows = monthlyList.byStatus[st] || [];
                if (!rows.length) return null;
                return (
                  <div key={st} className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {st} • {rows.length}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr className="border-b">
                            <th className="py-2 text-left">Project</th>
                            <th className="py-2 text-right">Status</th>
                            <th className="py-2 text-right">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p) => {
                            const myA: any = (p as any).assignments?.[0] ?? null;
                            const stLabel =
                              myA?.outcome === "CANCELLED"
                                ? "CANCELLED (for you)"
                                : p.status;
                            return (
                              <tr key={p.id} className="border-b last:border-b-0">
                                <td className="py-2">
                                  <Link
                                    href={`/app/projects/${p.id}`}
                                    className="hover:underline"
                                  >
                                    {p.title}
                                  </Link>
                                </td>
                                <td className="py-2 text-right">{stLabel}</td>
                                <td className="py-2 text-right text-xs text-muted-foreground">
                                  {new Date(p.updatedAt).toLocaleDateString()}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No projects for this month yet.
            </div>
          )}
        </div>
      ) : null}

      {period === "overall" ? (
        <div className="space-y-3">
          <MonthRangeFilter monthKeys={remoteAllMonthKeys} />
          <MonthsPagination
            period="overall"
            from={fromKey}
            to={toKey}
            page={mPage}
            total={remoteTotalMonths}
            pageSize={REMOTE_MONTHS_PER_PAGE}
          />
          <div className="space-y-3">
            {remotePageKeys.length ? (
              remotePageKeys.map((k) => {
                const g = remoteMonthMap[k] || {
                  rows: [],
                  avgRating: null,
                  paidTotal: 0,
                  unpaidTotal: 0,
                };
                return (
                  <details key={k} className="rounded-xl border bg-card p-4">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{k}</div>
                          <div className="text-xs text-muted-foreground">
                            Projects: {g.rows.length} • Avg Rating:{" "}
                            {g.avgRating != null ? g.avgRating.toFixed(1) : "—"}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground text-right">
                          Paid {g.paidTotal.toFixed(2)} • Unpaid {g.unpaidTotal.toFixed(2)}
                        </div>
                      </div>
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr className="border-b">
                            <th className="py-2 text-left">Project</th>
                            <th className="py-2 text-right">Status</th>
                            <th className="py-2 text-right">Rating</th>
                            <th className="py-2 text-right">Paid</th>
                            <th className="py-2 text-right">Unpaid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r) => (
                            <tr key={r.projectId} className="border-b last:border-b-0">
                              <td className="py-2">
                                <Link
                                  href={`/app/projects/${r.projectId}`}
                                  className="hover:underline"
                                >
                                  {r.title}
                                </Link>
                              </td>
                              <td className="py-2 text-right">{r.status}</td>
                              <td className="py-2 text-right">
                                {r.rating != null ? r.rating.toFixed(1) : "—"}
                              </td>
                              <td className="py-2 text-right">{r.paid.toFixed(2)}</td>
                              <td className="py-2 text-right">{r.unpaid.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                No months in selected range.
              </div>
            )}
          </div>
          <MonthsPagination
            period="overall"
            from={fromKey}
            to={toKey}
            page={mPage}
            total={remoteTotalMonths}
            pageSize={REMOTE_MONTHS_PER_PAGE}
          />
        </div>
      ) : null}

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">Last 6 months</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left">Month</th>
                <th className="py-2 text-right">Paid</th>
                <th className="py-2 text-right">Unpaid</th>
                <th className="py-2 text-right">Avg Rating</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.monthKey} className="border-b last:border-b-0">
                  <td className="py-2">{h.monthKey}</td>
                  <td className="py-2 text-right">
                    {h.paid.toFixed(2)} ({h.paidCount})
                  </td>
                  <td className="py-2 text-right">
                    {h.unpaid.toFixed(2)} ({h.unpaidCount})
                  </td>
                  <td className="py-2 text-right">
                    {h.ratingAvg != null ? h.ratingAvg.toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Note: "Monthly" earnings are grouped by payableOn month (matches payment schedule).
        </div>
      </div>
    </div>
  );
}