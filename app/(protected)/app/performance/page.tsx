// app/(protected)/app/performance/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { EmployeePickerDialog } from "./_components/employee-picker-dialog";
import { PaginationNav } from "./_components/pagination";
import { EmployeeProjectsTable } from "./_components/employee-projects-table";
import { MonthRangeFilter } from "./_components/month-range-filter";
import { MonthPicker } from "./_components/month-picker";
import { DateRangeFilter } from "./_components/date-range-filter";
import {
  getDateRangePerformance,
  getDateRangeProjectBreakdown,
  type DateRangeRow,
  type ProjectBreakdownRow,
} from "@/lib/onsite-points/date-range";
import { MonthGroups, type MonthGroup } from "./_components/month-groups";
import { getMultipleWorkerStats, getWorkerAssignmentStats } from "@/lib/worker-stats/assignments";
import { computeCommitmentIndex, computeMultipleCommitmentIndexes } from "@/lib/worker-stats/commitment-index";
import type { CommitmentIndex } from "@/lib/worker-stats/commitment-index";
import { getEstimatedForUsers, getUserEstimatedPoints } from "@/lib/onsite-points/aggregate";
import { EstimatedPointsPanel } from "@/components/app/estimated-points-panel";
import { sumManualForUser, sumManualByMonth, listManualForUser } from "@/lib/onsite-points/manual";
import { ManualPointsDialog } from "./_components/manual-points-dialog";
import { addManualPerformancePoint, deleteManualPerformancePoint } from "./actions";
import { CommitmentBadge, CommitmentIndexCard } from "@/components/app/commitment-index";
import {
  proratedMonthlyTarget,
  getAllWorkingDaysMap,
  DEFAULT_WORKING_DAYS,
} from "@/lib/onsite-points/target";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

type Tab =
  | "onsite_summary"
  | "onsite_employee"
  | "remote_summary"
  | "remote_employee"
  | "date_range";

type Period = "monthly" | "overall";

const TABS: { key: Tab; label: string }[] = [
  { key: "onsite_summary", label: "Onsite — Summary" },
  { key: "onsite_employee", label: "Onsite — Employee" },
  { key: "remote_summary", label: "Remote — Summary" },
  { key: "remote_employee", label: "Remote — Employee" },
  { key: "date_range", label: "Date Range" },
];

function parseTab(input?: string): Tab {
  const t = (input || "").toLowerCase();
  if (t === "onsite_employee") return "onsite_employee";
  if (t === "remote_summary") return "remote_summary";
  if (t === "remote_employee") return "remote_employee";
  if (t === "date_range") return "date_range";
  return "onsite_summary";
}

function parsePeriod(input?: string): Period {
  const p = (input || "").toLowerCase();
  return p === "overall" ? "overall" : "monthly";
}

function parsePage(input?: string) {
  const n = Number(input || "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parseMonthPage(input?: string) {
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

function monthRangeFromKey(key: string) {
  const [y, m] = key.split("-").map(Number);
  const start = new Date(y, (m ?? 1) - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1), 1, 0, 0, 0, 0);
  return { start, end };
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

// `countWorkingDays` and `proratedMonthlyTarget` now live in
// "@/lib/onsite-points/target" (single source of truth; Mon–Sat calendar,
// config-driven divisor). Imported at the top of this file.

function listMonthKeysInclusive(from: Date, to: Date) {
  const out: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    out.push(monthKeyOf(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function pct(n: number, d: number) {
  if (!d || d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function avg(nums: number[]) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function requireAdminLike(role?: Role) {
  const ok =
    role === "SUPER_ADMIN" ||
    role === "MANAGER" ||
    role === "BUSINESS_DEVELOPER" ||
    role === "BD";
  if (!ok) redirect("/app?err=forbidden");
}

async function getOnsiteUsers() {
  return prisma.user.findMany({
    where: { archivedAt: null, role: "ONSITE_EMPLOYEE" },
    select: {
      id: true,
      fullName: true,
      targetMonthlyPoints: true,
      workerType: true,
      joinedAt: true,
    },
    orderBy: { fullName: "asc" },
  });
}

async function getRemoteUsers() {
  return prisma.user.findMany({
    where: { archivedAt: null, role: "REMOTE_WORKER" },
    select: { id: true, fullName: true, workerType: true },
    orderBy: { fullName: "asc" },
  });
}

async function countOnsiteUsers() {
  return prisma.user.count({
    where: { archivedAt: null, role: "ONSITE_EMPLOYEE" },
  });
}

async function countRemoteUsers() {
  return prisma.user.count({
    where: { archivedAt: null, role: "REMOTE_WORKER" },
  });
}

async function getOnsiteUsersPage(skip: number, take: number) {
  return prisma.user.findMany({
    where: { archivedAt: null, role: "ONSITE_EMPLOYEE" },
    select: {
      id: true,
      fullName: true,
      targetMonthlyPoints: true,
      workerType: true,
      joinedAt: true,
    },
    orderBy: { fullName: "asc" },
    skip,
    take,
  });
}

async function getRemoteUsersPage(skip: number, take: number) {
  return prisma.user.findMany({
    where: { archivedAt: null, role: "REMOTE_WORKER" },
    select: { id: true, fullName: true, workerType: true },
    orderBy: { fullName: "asc" },
    skip,
    take,
  });
}



async function completionStatsForUser(
  userId: string,
  period: Period,
  monthStart: Date,
  monthEnd: Date
) {
  if (period === "overall") {
    // Completed: only assignments where this worker's outcome = COMPLETED
    // REMOVED workers are excluded — project completing after they left doesn't count
    const completed = await prisma.projectAssignment.count({
      where: { userId, outcome: "COMPLETED" as any },
    });

    // Cancelled: two cases —
    // (a) cancelled-for-worker by manager (outcome=CANCELLED)
    // (b) project was cancelled while worker was still actively assigned
    const [cancelledForWorker, projectCancelledWhileAssigned] = await Promise.all([
      prisma.projectAssignment.count({
        where: { userId, outcome: "CANCELLED" as any },
      }),
      prisma.projectAssignment.count({
        where: {
          userId,
          unassignedAt: null,
          project: { is: { status: "CANCELLED" } },
        },
      }),
    ]);

    return { completed, cancelled: cancelledForWorker + projectCancelledWhileAssigned };
  }

  // Monthly — filter by when the event happened
  const completed = await prisma.projectAssignment.count({
    where: {
      userId,
      outcome: "COMPLETED" as any,
      project: { is: { firstCompletedAt: { gte: monthStart, lt: monthEnd } } },
    },
  });

  const [cancelledForWorker, projectCancelledWhileAssigned] = await Promise.all([
    prisma.projectAssignment.count({
      where: {
        userId,
        outcome: "CANCELLED" as any,
        cancelledForWorkerAt: { gte: monthStart, lt: monthEnd },
      },
    }),
    prisma.projectAssignment.count({
      where: {
        userId,
        unassignedAt: null,
        project: {
          is: {
            status: "CANCELLED",
            cancelledAt: { gte: monthStart, lt: monthEnd },
          },
        },
      },
    }),
  ]);

  return { completed, cancelled: cancelledForWorker + projectCancelledWhileAssigned };
}




async function onsiteRatingAvgsForUser(
  userId: string,
  period: Period,
  monthKey: string
) {
  const credits = await prisma.onsitePointCredit.findMany({
    where: { userId, ...(period === "monthly" ? { monthKey } : {}) },
    select: {
      project: {
        select: {
          onsiteRating: {
            select: { m1: true, m2: true, m3: true, m4: true, m5: true },
          },
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
}

async function onsitePointsForUser(
  userId: string,
  period: Period,
  monthKey: string
) {
  const agg = await prisma.onsitePointCredit.aggregate({
    where: { userId, ...(period === "monthly" ? { monthKey } : {}) },
    _sum: { points: true },
    _count: { _all: true },
  });

  // Fold in manual ± performance points (same scope) — they count toward the
  // finalized total and therefore accuracy.
  const manual = await sumManualForUser(userId, {
    ...(period === "monthly" ? { monthKey } : {}),
  });

  const projectPoints = agg._sum.points ?? 0;

  return {
    achievedPoints: projectPoints + manual,
    projectPoints,
    manualPoints: manual,
    creditedProjects: agg._count._all ?? 0,
  };
}

async function remoteRatingAvgForUser(
  userId: string,
  period: Period,
  monthStart: Date,
  monthEnd: Date
) {
  const rows = await prisma.projectAssignment.findMany({
    where: {
      userId,
      project: {
        is: {
          rating: {
            is:
              period === "monthly"
                ? { ratedAt: { gte: monthStart, lt: monthEnd } }
                : {},
          },
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
}

async function remoteEarningsForUser(
  userId: string,
  period: Period,
  monthStart: Date,
  monthEnd: Date
) {
  const whereBase: any = {
    userId,
    ...(period === "monthly"
      ? { payableOn: { gte: monthStart, lt: monthEnd } }
      : {}),
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
}

function avgRemoteRating(rt: any) {
  if (!rt) return null;
  const nums = [rt.communication, rt.quality, rt.speed].concat(
    rt.professionalism != null ? [rt.professionalism] : []
  );
  return nums.reduce((a: number, b: number) => a + b, 0) / nums.length;
}

function avgOnsiteRating(or: any) {
  if (!or) return null;
  return (or.m1 + or.m2 + or.m3 + or.m4 + or.m5) / 5;
}

async function onsiteMonthlyAccuracyAvg(params: {
  userId: string;
  targetMonthlyPoints: number;
  joinedAt: Date;
  now: Date;
}) {
  const startMonth = new Date(
    params.joinedAt.getFullYear(),
    params.joinedAt.getMonth(),
    1
  );
  const prevMonth = new Date(
    params.now.getFullYear(),
    params.now.getMonth() - 1,
    1
  );

  if (prevMonth < startMonth) return null;

  const monthKeys = listMonthKeysInclusive(startMonth, prevMonth);
  const wdMap = await getAllWorkingDaysMap();

  const credits = await prisma.onsitePointCredit.findMany({
    where: { userId: params.userId },
    select: { monthKey: true, points: true },
    take: 100000,
  });

  const sums: Record<string, number> = {};
  for (const c of credits) sums[c.monthKey] = (sums[c.monthKey] ?? 0) + c.points;

  // Fold in manual ± points per month (a manual-only month counts as activity).
  const manualByMonth = await sumManualByMonth(params.userId, monthKeys);
  for (const [k, v] of manualByMonth) sums[k] = (sums[k] ?? 0) + v;

  // ✅ Only include months with actual activity (credits or manual)
  const monthsWithActivity = new Set(Object.keys(sums));

  const accuracies: number[] = [];
  for (const mk of monthKeys) {
    if (!monthsWithActivity.has(mk)) continue;
    const achieved = sums[mk] ?? 0;
    const target = proratedMonthlyTarget({
      targetMonthlyPoints: params.targetMonthlyPoints,
      joinedAt: params.joinedAt,
      monthKey: mk,
      workingDays: wdMap.get(mk) ?? DEFAULT_WORKING_DAYS,
    });
    if (!target || target <= 0) continue;
    accuracies.push((achieved / target) * 100);
  }

  return avg(accuracies);
}

function clampMonthKey(key: string | undefined) {
  if (!key) return null;
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  return key;
}

function monthKeyCompare(a: string, b: string) {
  return a.localeCompare(b);
}

function rangeBoundsFromMonthKeys(keys: string[]) {
  if (!keys.length) return null;

  let min = keys[0];
  let max = keys[0];
  for (const k of keys) {
    if (k < min) min = k;
    if (k > max) max = k;
  }

  const { start } = monthRangeFromKey(min);
  const { end } = monthRangeFromKey(max);
  return { start, end, minKey: min, maxKey: max };
}

async function completionStatsForUserRange(userId: string, start: Date, end: Date) {
  const completed = await prisma.projectAssignment.count({
    where: {
      userId,
      outcome: "COMPLETED" as any,
      project: { is: { firstCompletedAt: { gte: start, lt: end } } },
    },
  });

  const [cancelledForWorker, projectCancelledWhileAssigned] = await Promise.all([
    prisma.projectAssignment.count({
      where: {
        userId,
        outcome: "CANCELLED" as any,
        cancelledForWorkerAt: { gte: start, lt: end },
      },
    }),
    prisma.projectAssignment.count({
      where: {
        userId,
        unassignedAt: null,
        project: {
          is: {
            status: "CANCELLED",
            cancelledAt: { gte: start, lt: end },
          },
        },
      },
    }),
  ]);

  return { completed, cancelled: cancelledForWorker + projectCancelledWhileAssigned };
}







async function onsitePointsForMonthKeys(params: {
  userId: string;
  monthKeys: string[];
}) {
  if (!params.monthKeys.length) return { achievedPoints: 0, creditedProjects: 0 };

  const agg = await prisma.onsitePointCredit.aggregate({
    where: { userId: params.userId, monthKey: { in: params.monthKeys } },
    _sum: { points: true },
    _count: { _all: true },
  });

  // Fold in manual ± points across the same months.
  const manualByMonth = await sumManualByMonth(params.userId, params.monthKeys);
  let manual = 0;
  for (const v of manualByMonth.values()) manual += v;

  const projectPoints = agg._sum.points ?? 0;

  return {
    achievedPoints: projectPoints + manual,
    projectPoints,
    manualPoints: manual,
    creditedProjects: agg._count._all ?? 0,
  };
}

async function onsiteRatingAvgForMonthKeys(params: {
  userId: string;
  monthKeys: string[];
}) {
  if (!params.monthKeys.length) return null;

  const credits = await prisma.onsitePointCredit.findMany({
    where: { userId: params.userId, monthKey: { in: params.monthKeys } },
    select: {
      project: {
        select: {
          onsiteRating: {
            select: { m1: true, m2: true, m3: true, m4: true, m5: true },
          },
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
}

async function onsiteAccuracyAvgForMonthKeys(params: {
  userId: string;
  monthKeys: string[];
  targetMonthlyPoints: number;
  joinedAt: Date;
}) {
  if (!params.monthKeys.length) return null;
  const wdMap = await getAllWorkingDaysMap();

  const credits = await prisma.onsitePointCredit.findMany({
    where: { userId: params.userId, monthKey: { in: params.monthKeys } },
    select: { monthKey: true, points: true },
    take: 100000,
  });

  const sums: Record<string, number> = {};
  for (const c of credits) sums[c.monthKey] = (sums[c.monthKey] ?? 0) + c.points;

  // Fold in manual ± points per month (manual-only month counts as activity).
  const manualByMonth = await sumManualByMonth(params.userId, params.monthKeys);
  for (const [k, v] of manualByMonth) sums[k] = (sums[k] ?? 0) + v;

  // ✅ Only include months with actual activity (credits or manual)
  const monthsWithActivity = new Set(Object.keys(sums));

  const accuracies: number[] = [];
  for (const mk of params.monthKeys) {
    if (!monthsWithActivity.has(mk)) continue;
    const achieved = sums[mk] ?? 0;
    const target = proratedMonthlyTarget({
      targetMonthlyPoints: params.targetMonthlyPoints,
      joinedAt: params.joinedAt,
      monthKey: mk,
      workingDays: wdMap.get(mk) ?? DEFAULT_WORKING_DAYS,
    });

    if (!target || target <= 0) continue;
    accuracies.push((achieved / target) * 100);
  }

  return avg(accuracies);
}

function Pills({ tab, period }: { tab: Tab; period: Period }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/app/performance?tab=${t.key}&period=${period}`}
          className={[
            "rounded-full border px-3 py-1 text-sm",
            tab === t.key
              ? "bg-primary text-primary-foreground border-primary"
              : "hover:bg-muted",
          ].join(" ")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function PeriodSwitch({ tab, period }: { tab: Tab; period: Period }) {
  return (
    <div className="flex gap-2">
      <Link
        href={`/app/performance?tab=${tab}&period=monthly`}
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
        href={`/app/performance?tab=${tab}&period=overall`}
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

function monthKeyForOnsiteProject(p: {
  status: string;
  firstCompletedAt: Date | null;
  cancelledAt: Date | null;
}) {
  const d =
    p.status === "COMPLETED"
      ? p.firstCompletedAt
      : p.status === "CANCELLED"
      ? p.cancelledAt
      : null;
  return d ? monthKeyOf(new Date(d)) : null;
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    period?: string;
    userId?: string;
    page?: string;
    mPage?: string;
    from?: string;
    to?: string;
    month?: string;
    start?: string;
    end?: string;
  };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  await requireAdminLike(role);

  // Only Super Admin / Manager can add or remove manual points (BD sees them read-only).
  const canManageManual = role === "SUPER_ADMIN" || role === "MANAGER";

  const tab = parseTab(searchParams?.tab);
  const period = parsePeriod(searchParams?.period);

  const page = parsePage(searchParams?.page);
  const PAGE_SIZE = 10;
  const summarySkip = (page - 1) * PAGE_SIZE;

  const now = new Date();
  const currentMk = monthKeyOf(now);

  // Configured working days per month (Mon–Sat divisor). Any month without a
  // configured value falls back to DEFAULT_WORKING_DAYS.
  const wdMap = await getAllWorkingDaysMap();

  // Monthly tab is selectable via ?month=YYYY-MM (defaults to current month).
  // Never allow a future month.
  const requestedMonth = clampMonthKey(searchParams?.month);
  const mk =
    requestedMonth && requestedMonth <= currentMk ? requestedMonth : currentMk;
  const isCurrentMonth = mk === currentMk;
  const { start: monthStart, end: monthEnd } = monthRangeFromKey(mk);

  // Months selectable in the picker (newest first, up to 18 months back).
  const pickerMonths: string[] = (() => {
    const out: string[] = [];
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    for (let i = 0; i < 18; i++) {
      out.push(monthKeyOf(d));
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
    return out;
  })();

  const onsiteUsers = await getOnsiteUsers();
  const remoteUsers = await getRemoteUsers();

  const selectedUserId = searchParams?.userId || "";

  // ---------- Onsite Summary ----------
  let onsiteSummaryRows: any[] = [];
  let onsiteSummaryTotalPages = 1;

  if (tab === "onsite_summary") {
    const total = await countOnsiteUsers();
    onsiteSummaryTotalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const pagedUsers = await getOnsiteUsersPage(summarySkip, PAGE_SIZE);

    // Batch Commitment Index for all users on this page
    const statsMap = await getMultipleWorkerStats(pagedUsers.map((u) => u.id));
    const indexMap = computeMultipleCommitmentIndexes(statsMap);

    // Batch estimated (live) points for all users on this page — one pass.
    const estMap = await getEstimatedForUsers(pagedUsers.map((u) => u.id));

    onsiteSummaryRows = await Promise.all(
      pagedUsers.map(async (u) => {
        const { completed, cancelled } = await completionStatsForUser(
          u.id,
          period,
          monthStart,
          monthEnd
        );
        const completionRate = pct(completed, completed + cancelled);
        const ratingAvg = await onsiteRatingAvgsForUser(u.id, period, mk);
        const pts = await onsitePointsForUser(u.id, period, mk);

        let accuracy: number | null = null;
        if (period === "monthly") {
          const t = proratedMonthlyTarget({
            targetMonthlyPoints: u.targetMonthlyPoints,
            joinedAt: u.joinedAt,
            monthKey: mk,
            workingDays: wdMap.get(mk) ?? DEFAULT_WORKING_DAYS,
          });
          accuracy = t > 0 ? Math.round((pts.achievedPoints / t) * 100) : null;
        } else {
          const a = await onsiteMonthlyAccuracyAvg({
            userId: u.id,
            targetMonthlyPoints: u.targetMonthlyPoints,
            joinedAt: u.joinedAt,
            now,
          });
          accuracy = a != null ? Math.round(a) : null;
        }

        return {
          id: u.id,
          fullName: u.fullName,
          workerType: u.workerType,
          completed,
          cancelled,
          completionRate,
          ratingAvg,
          achievedPoints: pts.achievedPoints,
          accuracy,
          estimatedPoints: estMap.get(u.id)?.totalEstimatedPoints ?? 0,
          commitmentIndex: indexMap.get(u.id) ?? null,
        };
      })
    );
  }

  // ---------- Remote Summary ----------
  let remoteSummaryRows: any[] = [];
  let remoteSummaryTotalPages = 1;

  if (tab === "remote_summary") {
    const total = await countRemoteUsers();
    remoteSummaryTotalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const pagedUsers = await getRemoteUsersPage(summarySkip, PAGE_SIZE);

    // Batch Commitment Index for all workers on this page
    const statsMap = await getMultipleWorkerStats(pagedUsers.map((u) => u.id));
    const indexMap = computeMultipleCommitmentIndexes(statsMap);

    remoteSummaryRows = await Promise.all(
      pagedUsers.map(async (u) => {
        const { completed, cancelled } = await completionStatsForUser(
          u.id,
          period,
          monthStart,
          monthEnd
        );
        const completionRate = pct(completed, completed + cancelled);
        const ratingAvg = await remoteRatingAvgForUser(
          u.id,
          period,
          monthStart,
          monthEnd
        );
        const earnings = await remoteEarningsForUser(
          u.id,
          period,
          monthStart,
          monthEnd
        );

        return {
          id: u.id,
          fullName: u.fullName,
          workerType: u.workerType,
          completed,
          cancelled,
          completionRate,
          ratingAvg,
          ...earnings,
          commitmentIndex: indexMap.get(u.id) ?? null,
        };
      })
    );
  }

  // ---------- Employee Drilldown ----------
  const selectedOnsite =
    tab.startsWith("onsite") && selectedUserId
      ? onsiteUsers.find((u) => u.id === selectedUserId) || null
      : null;

  const selectedRemote =
    tab.startsWith("remote") && selectedUserId
      ? remoteUsers.find((u) => u.id === selectedUserId) || null
      : null;

  // Commitment Index for selected employee drilldowns
  let onsiteEmployeeCommitmentIndex: CommitmentIndex | null = null;
  if (tab === "onsite_employee" && selectedOnsite) {
    const stats = await getWorkerAssignmentStats(selectedOnsite.id);
    onsiteEmployeeCommitmentIndex = computeCommitmentIndex(stats);
  }

  let remoteEmployeeCommitmentIndex: CommitmentIndex | null = null;
  if (tab === "remote_employee" && selectedRemote) {
    const stats = await getWorkerAssignmentStats(selectedRemote.id);
    remoteEmployeeCommitmentIndex = computeCommitmentIndex(stats);
  }

  const fromKey = clampMonthKey(searchParams?.from);
  const toKey = clampMonthKey(searchParams?.to);
  const mPage = parseMonthPage(searchParams?.mPage);
  const MONTHS_PAGE_SIZE = 6;

  function monthKeysForEmployee(joinedAt: Date) {
    const start = new Date(joinedAt.getFullYear(), joinedAt.getMonth(), 1);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    if (prev < start) return [];
    return listMonthKeysInclusive(start, prev);
  }

  function applyRange(keys: string[]) {
    let out = keys.slice().sort(monthKeyCompare);
    if (fromKey) out = out.filter((k) => k >= fromKey);
    if (toKey) out = out.filter((k) => k <= toKey);
    return out;
  }

  function monthPagination(keys: string[]) {
    const totalPages = Math.max(1, Math.ceil(keys.length / MONTHS_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, mPage), totalPages);
    const start = (safePage - 1) * MONTHS_PAGE_SIZE;
    const slice = keys.slice(start, start + MONTHS_PAGE_SIZE);
    return { slice, totalPages, page: safePage };
  }

  // ---------- Drilldown: Onsite Employee ----------
  let onsiteEmployee: any = null;
  if (tab === "onsite_employee" && selectedOnsite) {
    const { completed, cancelled } = await completionStatsForUser(
      selectedOnsite.id,
      period,
      monthStart,
      monthEnd
    );
    const completionRate = pct(completed, completed + cancelled);
    const ratingAvg = await onsiteRatingAvgsForUser(selectedOnsite.id, period, mk);
    const pts = await onsitePointsForUser(selectedOnsite.id, period, mk);

    let accuracy: number | null = null;
    let estimatedAccuracy: number | null = null;
    const isViewingCurrentMonth = mk === monthKeyOf(now);
    const drillEstimated = await getUserEstimatedPoints(selectedOnsite.id);
    if (period === "monthly") {
      const t = proratedMonthlyTarget({
        targetMonthlyPoints: selectedOnsite.targetMonthlyPoints,
        joinedAt: selectedOnsite.joinedAt,
        monthKey: mk,
        workingDays: wdMap.get(mk) ?? DEFAULT_WORKING_DAYS,
      });
      accuracy = t > 0 ? Math.round((pts.achievedPoints / t) * 100) : null;
      // Projected accuracy = finalized + live estimated points, same target.
      // Only meaningful for the current month (no live estimate for past months).
      if (t > 0 && isViewingCurrentMonth) {
        estimatedAccuracy = Math.round(
          ((pts.achievedPoints + drillEstimated.totalEstimatedPoints) / t) * 100
        );
      }
    } else {
      const a = await onsiteMonthlyAccuracyAvg({
        userId: selectedOnsite.id,
        targetMonthlyPoints: selectedOnsite.targetMonthlyPoints,
        joinedAt: selectedOnsite.joinedAt,
        now,
      });
      accuracy = a != null ? Math.round(a) : null;
    }

    onsiteEmployee = {
      ...selectedOnsite,
      completed,
      cancelled,
      completionRate,
      ratingAvg,
      achievedPoints: pts.achievedPoints,
      projectPoints: pts.projectPoints,
      manualPoints: pts.manualPoints,
      creditedProjects: pts.creditedProjects,
      accuracy,
      estimatedAccuracy,
      estimatedSummary: drillEstimated,
      manualEntries: await listManualForUser(
        selectedOnsite.id,
        period === "monthly" ? { monthKey: mk } : {}
      ),
    };
  }

  // ---------- Drilldown: Remote Employee ----------
  let remoteEmployee: any = null;
  if (tab === "remote_employee" && selectedRemote) {
    const { completed, cancelled } = await completionStatsForUser(
      selectedRemote.id,
      period,
      monthStart,
      monthEnd
    );
    const completionRate = pct(completed, completed + cancelled);
    const ratingAvg = await remoteRatingAvgForUser(
      selectedRemote.id,
      period,
      monthStart,
      monthEnd
    );
    const earnings = await remoteEarningsForUser(
      selectedRemote.id,
      period,
      monthStart,
      monthEnd
    );

    remoteEmployee = {
      ...selectedRemote,
      completed,
      cancelled,
      completionRate,
      ratingAvg,
      ...earnings,
    };
  }

  // ---------- Monthly tables ----------
  let onsiteProjectRows: any[] = [];
  if (tab === "onsite_employee" && selectedOnsite && period === "monthly") {
    const rows = await prisma.projectAssignment.findMany({
      where: {
        userId: selectedOnsite.id,
        project: { is: { status: { in: ["COMPLETED", "CANCELLED"] } } },
      },
      select: {
        project: {
          select: {
            id: true,
            title: true,
            status: true,
            firstCompletedAt: true,
            cancelledAt: true,
            onsiteRating: {
              select: { m1: true, m2: true, m3: true, m4: true, m5: true },
            },
          },
        },
      },
      orderBy: { project: { updatedAt: "desc" } },
      take: 300,
    });

    const projects = rows
      .map((r) => r.project)
      .filter((p) => {
        if (p.status === "COMPLETED") {
          return (
            !!p.firstCompletedAt &&
            p.firstCompletedAt >= monthStart &&
            p.firstCompletedAt < monthEnd
          );
        }
        return (
          !!p.cancelledAt &&
          p.cancelledAt >= monthStart &&
          p.cancelledAt < monthEnd
        );
      });

    const ids = projects.map((p) => p.id);

    const credits = await prisma.onsitePointCredit.findMany({
      where: { userId: selectedOnsite.id, projectId: { in: ids }, monthKey: mk },
      select: { projectId: true, points: true },
      take: 100000,
    });

    const ptsMap = new Map<string, number>();
    for (const c of credits)
      ptsMap.set(c.projectId, (ptsMap.get(c.projectId) ?? 0) + c.points);

    onsiteProjectRows = projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      ratingAvg: avgOnsiteRating(p.onsiteRating),
      points: ptsMap.get(p.id) ?? 0,
      paidAmount: null,
      unpaidAmount: null,
    }));
  }

  let remoteProjectRows: any[] = [];
  if (tab === "remote_employee" && selectedRemote && period === "monthly") {
    const rows = await prisma.projectAssignment.findMany({
      where: {
        userId: selectedRemote.id,
        project: { is: { status: { in: ["COMPLETED", "CANCELLED"] } } },
      },
      select: {
        project: {
          select: {
            id: true,
            title: true,
            status: true,
            firstCompletedAt: true,
            cancelledAt: true,
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
      orderBy: { project: { updatedAt: "desc" } },
      take: 300,
    });

    const projects = rows
      .map((r) => r.project)
      .filter((p) => {
        if (p.status === "COMPLETED") {
          return (
            !!p.firstCompletedAt &&
            p.firstCompletedAt >= monthStart &&
            p.firstCompletedAt < monthEnd
          );
        }
        return (
          !!p.cancelledAt &&
          p.cancelledAt >= monthStart &&
          p.cancelledAt < monthEnd
        );
      });

    const ids = projects.map((p) => p.id);

    const lines = await prisma.projectPaymentLine.findMany({
      where: {
        userId: selectedRemote.id,
        projectId: { in: ids },
        payableOn: { gte: monthStart, lt: monthEnd },
      },
      select: { projectId: true, amount: true, status: true },
      take: 100000,
    });

    const paid = new Map<string, number>();
    const unpaid = new Map<string, number>();

    for (const l of lines) {
      const amt = Number((l as any).amount?.toString?.() ?? l.amount ?? 0);
      if (l.status === "PAID" || l.status === "EXCEPTION_PAID")
        paid.set(l.projectId!, (paid.get(l.projectId!) ?? 0) + amt);
      if (l.status === "UNPAID")
        unpaid.set(l.projectId!, (unpaid.get(l.projectId!) ?? 0) + amt);
    }

    remoteProjectRows = projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      ratingAvg: avgRemoteRating(p.rating),
      points: null,
      paidAmount: String(paid.get(p.id) ?? 0),
      unpaidAmount: String(unpaid.get(p.id) ?? 0),
    }));
  }

  // ---------- Overall drilldown: Month groups ----------
  let onsiteOverallMonthKeys: string[] = [];
  let onsiteOverallPagedKeys: string[] = [];
  let onsiteOverallTotalMonthPages = 1;
  let onsiteOverallMonthGroups: MonthGroup[] = [];

  let onsiteSelectedSummary: null | {
    label: string;
    completionRate: number;
    completed: number;
    cancelled: number;
    ratingAvg: number | null;
    achievedPoints: number;
    accuracy: number | null;
  } = null;

  if (tab === "onsite_employee" && selectedOnsite && period === "overall") {
    const allKeys = monthKeysForEmployee(selectedOnsite.joinedAt);
    const ranged = applyRange(allKeys);
    onsiteOverallMonthKeys = ranged;

    const selectedKeys = ranged.slice();
    const bounds = rangeBoundsFromMonthKeys(selectedKeys);

    if (bounds) {
      const { completed: rCompleted, cancelled: rCancelled } =
        await completionStatsForUserRange(selectedOnsite.id, bounds.start, bounds.end);

      const rCompletionRate = pct(rCompleted, rCompleted + rCancelled);
      const rRatingAvg = await onsiteRatingAvgForMonthKeys({
        userId: selectedOnsite.id,
        monthKeys: selectedKeys,
      });
      const rPts = await onsitePointsForMonthKeys({
        userId: selectedOnsite.id,
        monthKeys: selectedKeys,
      });
      const rAccAvg = await onsiteAccuracyAvgForMonthKeys({
        userId: selectedOnsite.id,
        monthKeys: selectedKeys,
        targetMonthlyPoints: selectedOnsite.targetMonthlyPoints,
        joinedAt: selectedOnsite.joinedAt,
      });

      onsiteSelectedSummary = {
        label: `${bounds.minKey} → ${bounds.maxKey}`,
        completionRate: rCompletionRate,
        completed: rCompleted,
        cancelled: rCancelled,
        ratingAvg: rRatingAvg,
        achievedPoints: rPts.achievedPoints,
        accuracy: rAccAvg != null ? Math.round(rAccAvg) : null,
      };
    }

    const paged = monthPagination(ranged);
    onsiteOverallPagedKeys = paged.slice;
    onsiteOverallTotalMonthPages = paged.totalPages;

    const keySet = new Set(onsiteOverallPagedKeys);

    const assignments = await prisma.projectAssignment.findMany({
      where: {
        userId: selectedOnsite.id,
        project: {
          is: {
            OR: [
              { status: "COMPLETED", firstCompletedAt: { not: null } },
              { status: "CANCELLED", cancelledAt: { not: null } },
            ],
          },
        },
      },
      select: {
        project: {
          select: {
            id: true,
            title: true,
            status: true,
            firstCompletedAt: true,
            cancelledAt: true,
            onsiteRating: {
              select: { m1: true, m2: true, m3: true, m4: true, m5: true },
            },
          },
        },
      },
      take: 10000,
    });

    const projectsByMonth: Record<string, any[]> = {};
    for (const a of assignments) {
      const p = a.project;
      const k = monthKeyForOnsiteProject({
        status: p.status as any,
        firstCompletedAt: (p as any).firstCompletedAt ?? null,
        cancelledAt: (p as any).cancelledAt ?? null,
      });
      if (!k || !keySet.has(k)) continue;
      if (!projectsByMonth[k]) projectsByMonth[k] = [];
      if (projectsByMonth[k].some((x) => x.id === p.id)) continue;
      projectsByMonth[k].push({
        id: p.id,
        title: p.title,
        status: p.status,
        ratingAvg: avgOnsiteRating(p.onsiteRating),
        points: 0,
      });
    }

    const credits = await prisma.onsitePointCredit.findMany({
      where: { userId: selectedOnsite.id, monthKey: { in: onsiteOverallPagedKeys } },
      select: { monthKey: true, projectId: true, points: true },
      take: 200000,
    });

    const ptsByMonthProject = new Map<string, number>();
    for (const c of credits) {
      const key = `${c.monthKey}:${c.projectId}`;
      ptsByMonthProject.set(key, (ptsByMonthProject.get(key) ?? 0) + c.points);
    }

    for (const k of onsiteOverallPagedKeys) {
      const rows = projectsByMonth[k] ?? [];
      for (const row of rows) {
        row.points = ptsByMonthProject.get(`${k}:${row.id}`) ?? 0;
      }
    }

    onsiteOverallMonthGroups = onsiteOverallPagedKeys.map((k) => {
      const rows = projectsByMonth[k] ?? [];
      const pointsSum = rows.reduce((a, r) => a + (r.points ?? 0), 0);
      const target = proratedMonthlyTarget({
        targetMonthlyPoints: selectedOnsite.targetMonthlyPoints,
        joinedAt: selectedOnsite.joinedAt,
        monthKey: k,
        workingDays: wdMap.get(k) ?? DEFAULT_WORKING_DAYS,
      });
      const acc = target > 0 ? Math.round((pointsSum / target) * 100) : null;
      return {
        monthKey: k,
        summaryRight: `Points ${pointsSum} • Target ${
          target ? Math.round(target) : 0
        } • Acc ${acc != null ? acc + "%" : "—"} • ${rows.length} projects`,
        rows,
      };
    });
  }

  let remoteOverallMonthKeys: string[] = [];
  let remoteOverallPagedKeys: string[] = [];
  let remoteOverallTotalMonthPages = 1;
  let remoteOverallMonthGroups: MonthGroup[] = [];

  if (tab === "remote_employee" && selectedRemote && period === "overall") {
    const earliest = await prisma.projectPaymentLine.findFirst({
      where: { userId: selectedRemote.id },
      select: { payableOn: true },
      orderBy: { payableOn: "asc" },
    });

    if (earliest?.payableOn) {
      const start = new Date(
        earliest.payableOn.getFullYear(),
        earliest.payableOn.getMonth(),
        1
      );
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const allKeys = prev < start ? [] : listMonthKeysInclusive(start, prev);
      const ranged = applyRange(allKeys);
      remoteOverallMonthKeys = ranged;

      const paged = monthPagination(ranged);
      remoteOverallPagedKeys = paged.slice;
      remoteOverallTotalMonthPages = paged.totalPages;

      const monthLines = await prisma.projectPaymentLine.findMany({
        where: {
          userId: selectedRemote.id,
          payableOn: {
            gte: monthRangeFromKey(
              remoteOverallPagedKeys[remoteOverallPagedKeys.length - 1] || mk
            ).start,
          },
        },
        select: {
          projectId: true,
          payableOn: true,
          amount: true,
          status: true,
          project: {
            select: {
              id: true,
              title: true,
              status: true,
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
        take: 200000,
      });

      const byMonth: Record<string, { rows: any[]; paid: number; unpaid: number }> = {};

      for (const l of monthLines) {
        if (!l.project || !l.projectId) continue;
        if (!l.payableOn) continue;
const k = monthKeyOf(new Date(l.payableOn));
        if (!remoteOverallPagedKeys.includes(k)) continue;
        if (!byMonth[k]) byMonth[k] = { rows: [], paid: 0, unpaid: 0 };
        const amt = Number((l as any).amount?.toString?.() ?? l.amount ?? 0);
        if (l.status === "PAID" || l.status === "EXCEPTION_PAID") byMonth[k].paid += amt;
        if (l.status === "UNPAID") byMonth[k].unpaid += amt;
        byMonth[k].rows.push({
          id: l.project.id,
          title: l.project.title,
          status: l.project.status,
          ratingAvg: avgRemoteRating(l.project.rating),
          paidAmount:
            l.status === "PAID" || l.status === "EXCEPTION_PAID" ? String(amt) : "0",
          unpaidAmount: l.status === "UNPAID" ? String(amt) : "0",
        });
      }

      remoteOverallMonthGroups = remoteOverallPagedKeys.map((k) => {
        const g = byMonth[k] || { rows: [], paid: 0, unpaid: 0 };
        return {
          monthKey: k,
          summaryRight: `Paid ${g.paid.toFixed(2)} • Unpaid ${g.unpaid.toFixed(
            2
          )} • ${g.rows.length} lines`,
          rows: g.rows,
        };
      });
    }
  }

  function monthHref(p: number) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("period", "overall");
    if (selectedUserId) params.set("userId", selectedUserId);
    if (fromKey) params.set("from", fromKey);
    if (toKey) params.set("to", toKey);
    params.set("mPage", String(p));
    return `/app/performance?${params.toString()}`;
  }

  // ---------- Date Range tab (single employee) ----------
  let drStart = (searchParams?.start || "").trim();
  let drEnd = (searchParams?.end || "").trim();
  let dateRangeRow: DateRangeRow | null = null;
  let dateRangeBreakdown: ProjectBreakdownRow[] | null = null;
  let drSelectedUser: { id: string; fullName: string } | null = null;
  let drValidDates = false;

  if (tab === "date_range") {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    drValidDates = dateRe.test(drStart) && dateRe.test(drEnd) && drStart <= drEnd;

    const su = selectedUserId
      ? onsiteUsers.find((u) => u.id === selectedUserId) ?? null
      : null;
    if (su) drSelectedUser = { id: su.id, fullName: su.fullName };

    if (drValidDates && su) {
      const startDate = new Date(`${drStart}T00:00:00.000Z`);
      const endDate = new Date(`${drEnd}T23:59:59.999Z`);

      const rows = await getDateRangePerformance(
        [{ id: su.id, fullName: su.fullName, targetMonthlyPoints: su.targetMonthlyPoints }],
        startDate,
        endDate
      );
      dateRangeRow = rows[0] ?? null;
      dateRangeBreakdown = await getDateRangeProjectBreakdown(su.id, startDate, endDate);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-muted-foreground">
            Tabs-based summaries + employee drilldown (Monthly / Overall).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab !== "date_range" && period === "monthly" ? (
            <MonthPicker
              monthKeys={pickerMonths}
              current={mk}
              tab={tab}
              userId={selectedUserId || undefined}
            />
          ) : null}
          {tab !== "date_range" ? <PeriodSwitch tab={tab} period={period} /> : null}
        </div>
      </div>

      <Pills tab={tab} period={period} />

      {/* ── ONSITE SUMMARY ── */}
      {tab === "onsite_summary" ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Onsite Employees — Summary</div>
              <div className="text-xs text-muted-foreground">
                {period === "monthly" ? `Month: ${mk}` : "All-time (avg monthly acc excluding current month)"}
              </div>
            </div>
            <Link
              className="text-sm underline"
              href={`/app/performance?tab=onsite_employee&period=${period}`}
            >
              Open employee tab
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left">Employee</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-right">Completion</th>
                  <th className="py-2 text-right">Avg Rating</th>
                  <th className="py-2 text-right">Finalized</th>
                  <th className="py-2 text-right">Est. (live)</th>
                  <th className="py-2 text-right">Accuracy</th>
                  <th className="py-2 text-right">Commitment</th>
                </tr>
              </thead>
              <tbody>
                {onsiteSummaryRows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="py-2">
                      <Link
                        className="underline"
                        href={`/app/performance?tab=onsite_employee&period=${period}&userId=${r.id}`}
                      >
                        {r.fullName}
                      </Link>
                    </td>
                    <td className="py-2">{r.workerType || "—"}</td>
                    <td className="py-2 text-right">{r.completionRate}%</td>
                    <td className="py-2 text-right">
                      {r.ratingAvg != null ? r.ratingAvg.toFixed(1) : "—"}
                    </td>
                    <td className="py-2 text-right">{r.achievedPoints}</td>
                    <td className="py-2 text-right text-muted-foreground">
                      {isCurrentMonth
                        ? r.estimatedPoints > 0
                          ? `~${r.estimatedPoints}`
                          : "—"
                        : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {r.accuracy != null ? `${r.accuracy}%` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {r.commitmentIndex ? (
                        <CommitmentBadge index={r.commitmentIndex} />
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <PaginationNav
              page={page}
              totalPages={onsiteSummaryTotalPages}
              hrefForPage={(p) =>
                `/app/performance?tab=onsite_summary&period=${period}&page=${p}`
              }
            />
          </div>
        </div>
      ) : null}

      {/* ── ONSITE EMPLOYEE ── */}
      {tab === "onsite_employee" ? (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Onsite — Employee</div>
              <div className="text-xs text-muted-foreground">
                {period === "monthly"
                  ? `Month: ${mk}`
                  : "Overall (months expandable, excludes current month)"}
              </div>
            </div>
            <EmployeePickerDialog
              title="Select onsite employee"
              users={onsiteUsers.map((u) => ({ id: u.id, fullName: u.fullName }))}
              hrefBase={`/app/performance?tab=onsite_employee&period=${period}&userId=`}
            />
          </div>

          {!onsiteEmployee ? (
            <div className="text-sm text-muted-foreground">
              Select an employee to view details.
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-sm font-medium">{onsiteEmployee.fullName}</div>
                <div className="text-xs text-muted-foreground">
                  {onsiteEmployee.workerType || "—"}
                </div>
              </div>

              {/* Commitment Index card */}
              {onsiteEmployeeCommitmentIndex && (
                <CommitmentIndexCard
                  index={onsiteEmployeeCommitmentIndex}
                  workerName={onsiteEmployee.fullName}
                  showCancellationDetail={true}
                />
              )}

              <div className="grid md:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Completion Rate</div>
                  <div className="text-lg font-semibold">{onsiteEmployee.completionRate}%</div>
                  <div className="text-xs text-muted-foreground">
                    Completed {onsiteEmployee.completed} • Cancelled {onsiteEmployee.cancelled}
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Avg Onsite Rating</div>
                  <div className="text-lg font-semibold">
                    {onsiteEmployee.ratingAvg != null
                      ? onsiteEmployee.ratingAvg.toFixed(1)
                      : "—"}
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Points Accuracy</div>
                  <div className="text-lg font-semibold">
                    {onsiteEmployee.accuracy != null ? `${onsiteEmployee.accuracy}%` : "—"}
                  </div>
                  {onsiteEmployee.estimatedAccuracy != null ? (
                    <div className="mt-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
                      {onsiteEmployee.estimatedAccuracy}% projected
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (incl. in-flight)
                      </span>
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    {period === "monthly"
                      ? `Achieved ${onsiteEmployee.achievedPoints}${
                          onsiteEmployee.manualPoints
                            ? ` (${onsiteEmployee.projectPoints} project ${
                                onsiteEmployee.manualPoints > 0 ? "+" : "−"
                              } ${Math.abs(onsiteEmployee.manualPoints)} manual)`
                            : ""
                        } • Target ${onsiteEmployee.targetMonthlyPoints}`
                      : "Overall accuracy = avg of monthly accuracies (excluding current month)"}
                  </div>
                </div>
              </div>

              {/* Live estimated layer — current month only (estimates are "now") */}
              {isCurrentMonth && onsiteEmployee.estimatedSummary && (
                <EstimatedPointsPanel summary={onsiteEmployee.estimatedSummary} />
              )}

              {/* Manual ± performance points (Manager / Super Admin) */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">Manual Points</div>
                    <div className="text-xs text-muted-foreground">
                      ± adjustments with a note. Counts toward finalized points
                      &amp; accuracy, in the month given.
                      {period !== "monthly" ? " Showing all-time entries." : ` Showing ${mk}.`}
                    </div>
                  </div>
                  {canManageManual ? (
                    <ManualPointsDialog
                      userId={onsiteEmployee.id}
                      period={period}
                      monthKey={mk}
                      action={addManualPerformancePoint}
                    />
                  ) : null}
                </div>

                {onsiteEmployee.manualEntries.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No manual entries{period === "monthly" ? ` for ${mk}` : ""} yet.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {onsiteEmployee.manualEntries.map((m: any) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate">{m.note}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {m.monthKey}
                            {m.createdByName ? ` • by ${m.createdByName}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`font-semibold ${
                              m.points < 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-emerald-700 dark:text-emerald-400"
                            }`}
                          >
                            {m.points > 0 ? `+${m.points}` : m.points}
                          </span>
                          {canManageManual ? (
                            <form action={deleteManualPerformancePoint}>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="userId" value={onsiteEmployee.id} />
                              <input type="hidden" name="period" value={period} />
                              <button
                                type="submit"
                                className="text-[11px] text-muted-foreground underline hover:text-red-600"
                              >
                                delete
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {period === "monthly" ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Credited projects in scope: {onsiteEmployee.creditedProjects}
                  </div>
                  <EmployeeProjectsTable kind="onsite" rows={onsiteProjectRows} />
                </>
              ) : (
                <>
                  <MonthRangeFilter
                    monthKeys={onsiteOverallMonthKeys}
                    tab="onsite_employee"
                    userId={onsiteEmployee.id}
                  />

                  {onsiteSelectedSummary ? (
                    <div className="rounded-xl border bg-card p-4">
                      <div className="text-sm font-medium">
                        Selected range — {onsiteSelectedSummary.label}
                      </div>
                      <div className="mt-3 grid md:grid-cols-3 gap-3">
                        <div className="rounded-lg border p-3">
                          <div className="text-xs text-muted-foreground">Completion Rate</div>
                          <div className="text-lg font-semibold">
                            {onsiteSelectedSummary.completionRate}%
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Completed {onsiteSelectedSummary.completed} • Cancelled{" "}
                            {onsiteSelectedSummary.cancelled}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs text-muted-foreground">Avg Onsite Rating</div>
                          <div className="text-lg font-semibold">
                            {onsiteSelectedSummary.ratingAvg != null
                              ? onsiteSelectedSummary.ratingAvg.toFixed(1)
                              : "—"}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs text-muted-foreground">Points Accuracy</div>
                          <div className="text-lg font-semibold">
                            {onsiteSelectedSummary.accuracy != null
                              ? `${onsiteSelectedSummary.accuracy}%`
                              : "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Points {onsiteSelectedSummary.achievedPoints} • Accuracy = avg
                            month accuracies in range
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <PaginationNav
                    page={parseMonthPage(searchParams?.mPage)}
                    totalPages={onsiteOverallTotalMonthPages}
                    hrefForPage={(p) => monthHref(p)}
                  />

                  <MonthGroups kind="onsite" groups={onsiteOverallMonthGroups} />

                  <PaginationNav
                    page={parseMonthPage(searchParams?.mPage)}
                    totalPages={onsiteOverallTotalMonthPages}
                    hrefForPage={(p) => monthHref(p)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* ── REMOTE SUMMARY ── */}
      {tab === "remote_summary" ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Remote Workers — Summary</div>
              <div className="text-xs text-muted-foreground">
                {period === "monthly" ? `Month: ${mk}` : "All-time"}
              </div>
            </div>
            <Link
              className="text-sm underline"
              href={`/app/performance?tab=remote_employee&period=${period}`}
            >
              Open employee tab
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left">Worker</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-right">Completion</th>
                  <th className="py-2 text-right">Avg Rating</th>
                  <th className="py-2 text-right">Paid</th>
                  <th className="py-2 text-right">Unpaid</th>
                  <th className="py-2 text-right">Commitment</th>
                </tr>
              </thead>
              <tbody>
                {remoteSummaryRows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="py-2">
                      <Link
                        className="underline"
                        href={`/app/performance?tab=remote_employee&period=${period}&userId=${r.id}`}
                      >
                        {r.fullName}
                      </Link>
                    </td>
                    <td className="py-2">{r.workerType || "—"}</td>
                    <td className="py-2 text-right">{r.completionRate}%</td>
                    <td className="py-2 text-right">
                      {r.ratingAvg != null ? r.ratingAvg.toFixed(1) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {r.paidAmount} ({r.paidCount})
                    </td>
                    <td className="py-2 text-right">
                      {r.unpaidAmount} ({r.unpaidCount})
                    </td>
                    <td className="py-2 text-right">
                      {r.commitmentIndex ? (
                        <CommitmentBadge index={r.commitmentIndex} />
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <PaginationNav
              page={page}
              totalPages={remoteSummaryTotalPages}
              hrefForPage={(p) =>
                `/app/performance?tab=remote_summary&period=${period}&page=${p}`
              }
            />
          </div>
        </div>
      ) : null}

      {/* ── REMOTE EMPLOYEE ── */}
      {tab === "remote_employee" ? (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Remote — Employee</div>
              <div className="text-xs text-muted-foreground">
                {period === "monthly"
                  ? `Month: ${mk}`
                  : "Overall (months expandable) — grouped by payableOn month"}
              </div>
            </div>
            <EmployeePickerDialog
              title="Select remote worker"
              users={remoteUsers.map((u) => ({ id: u.id, fullName: u.fullName }))}
              hrefBase={`/app/performance?tab=remote_employee&period=${period}&userId=`}
            />
          </div>

          {!remoteEmployee ? (
            <div className="text-sm text-muted-foreground">
              Select a worker to view details.
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-sm font-medium">{remoteEmployee.fullName}</div>
                <div className="text-xs text-muted-foreground">
                  {remoteEmployee.workerType || "—"}
                </div>
              </div>

              {/* Commitment Index card */}
              {remoteEmployeeCommitmentIndex && (
                <CommitmentIndexCard
                  index={remoteEmployeeCommitmentIndex}
                  workerName={remoteEmployee.fullName}
                  showCancellationDetail={true}
                />
              )}

              <div className="grid md:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Completion Rate</div>
                  <div className="text-lg font-semibold">{remoteEmployee.completionRate}%</div>
                  <div className="text-xs text-muted-foreground">
                    Completed {remoteEmployee.completed} • Cancelled {remoteEmployee.cancelled}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Avg Project Rating</div>
                  <div className="text-lg font-semibold">
                    {remoteEmployee.ratingAvg != null
                      ? remoteEmployee.ratingAvg.toFixed(1)
                      : "—"}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Earnings</div>
                  <div className="text-sm">
                    Paid: <span className="font-medium">{remoteEmployee.paidAmount}</span>{" "}
                    ({remoteEmployee.paidCount})
                  </div>
                  <div className="text-sm">
                    Unpaid:{" "}
                    <span className="font-medium">{remoteEmployee.unpaidAmount}</span>{" "}
                    ({remoteEmployee.unpaidCount})
                  </div>
                </div>
              </div>

              {period === "monthly" ? (
                <EmployeeProjectsTable kind="remote" rows={remoteProjectRows} />
              ) : (
                <>
                  <MonthRangeFilter
                    monthKeys={remoteOverallMonthKeys}
                    tab="remote_employee"
                    userId={remoteEmployee.id}
                  />
                  <PaginationNav
                    page={parseMonthPage(searchParams?.mPage)}
                    totalPages={remoteOverallTotalMonthPages}
                    hrefForPage={(p) => monthHref(p)}
                  />
                  <MonthGroups kind="remote" groups={remoteOverallMonthGroups} />
                  <PaginationNav
                    page={parseMonthPage(searchParams?.mPage)}
                    totalPages={remoteOverallTotalMonthPages}
                    hrefForPage={(p) => monthHref(p)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* ── DATE RANGE (single employee) ── */}
      {tab === "date_range" ? (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium">Date Range Performance</div>
            <p className="text-xs text-muted-foreground">
              Points and accuracy for one employee over a custom date span. Target
              is each month&apos;s points pro-rated by its configured working days.
              Project points count by completion date; manual points by date given.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <EmployeePickerDialog
              title="Select onsite employee"
              users={onsiteUsers.map((u) => ({ id: u.id, fullName: u.fullName }))}
              hrefBase={`/app/performance?tab=date_range&start=${encodeURIComponent(
                drStart
              )}&end=${encodeURIComponent(drEnd)}&userId=`}
            />
            <div className="text-sm">
              {drSelectedUser ? (
                <span className="font-medium">{drSelectedUser.fullName}</span>
              ) : (
                <span className="text-muted-foreground">No employee selected</span>
              )}
            </div>
          </div>

          <DateRangeFilter
            start={drStart}
            end={drEnd}
            userId={selectedUserId || undefined}
          />

          {!drSelectedUser || !drValidDates ? (
            <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              Select an employee and a From / To date, then press Generate.
            </div>
          ) : dateRangeRow ? (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border bg-card p-4">
                  <div className="text-xs text-muted-foreground">Achieved Points</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {dateRangeRow.achievedPoints}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {dateRangeRow.projectPoints} project
                    {dateRangeRow.manualPoints !== 0
                      ? ` ${dateRangeRow.manualPoints > 0 ? "+" : "−"} ${Math.abs(
                          dateRangeRow.manualPoints
                        )} manual`
                      : ""}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="text-xs text-muted-foreground">Target</div>
                  <div className="mt-1 text-2xl font-semibold">{dateRangeRow.target}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    pro-rated by configured working days
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="text-xs text-muted-foreground">Accuracy</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {dateRangeRow.accuracy != null ? `${dateRangeRow.accuracy}%` : "—"}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="text-xs text-muted-foreground">Working Days</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {dateRangeRow.workingDays}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Mon–Fri in range
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="text-sm font-medium">
                  Projects completed in range
                </div>
                {!dateRangeBreakdown || dateRangeBreakdown.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No projects completed in this range.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {dateRangeBreakdown.map((p) => (
                      <div
                        key={p.projectId}
                        className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{p.title}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {p.completedAt
                              ? new Date(p.completedAt).toLocaleDateString()
                              : "—"}
                          </div>
                        </div>
                        <div className="shrink-0 font-semibold">
                          {p.points} pt{p.points === 1 ? "" : "s"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}