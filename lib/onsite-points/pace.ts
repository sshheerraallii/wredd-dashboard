import { getPrisma } from "@/lib/prisma";
import {
  proratedMonthlyTarget,
  getAllWorkingDaysMap,
  DEFAULT_WORKING_DAYS,
} from "@/lib/onsite-points/target";
import { getUserEstimatedPoints } from "@/lib/onsite-points/aggregate";
import { resolveEverDelivered, type ProjectStatus } from "@/lib/onsite-points/estimate";
import { sumManualForUser } from "@/lib/onsite-points/manual";

const prisma = getPrisma();

/**
 * Delivery Pace Card engine (onsite workers).
 *
 * A forward-looking daily plan: active work (IN_PROGRESS + REVISION) queued by
 * assignment order, laid across upcoming Mon–Sat 8h days, each project given a
 * target delivery day. Revisions are gated on the worker's projected accuracy —
 * a worker on/above target earns a small allowance for rework, a worker behind
 * gets none (revision is "deliver today"), which keeps the rest of the queue
 * tight. The "behind" signal itself is the projected-accuracy banner, not the
 * pace dates. See WREDD_Pace_Card_Spec for the full model.
 *
 * This is a pace guide, not a deadline engine and not a time tracker.
 */

const WORK_DAY_HOURS = 8; // worker-facing day (the internal 6.5h figure never surfaces here)
const REVISION_ALLOWANCE = 0.3; // 30% of original hours, only when projected accuracy >= 100
const UNDERLOAD_THRESHOLD_HOURS = 8; // total planned work under one day -> "pick up more" nudge

export type PaceKind =
  | "FIRST_PASS"
  | "REVISION"
  | "REVISION_URGENT"
  | "AWAITING_HOURS";

export type PaceLine = {
  projectId: string;
  title: string;
  kind: PaceKind;
  workHours: number; // 0 for urgent revisions and awaiting-hours
  targetDate: Date | null; // null only for awaiting-hours
  dayLabel: string | null; // "today" | "tomorrow" | "Tuesday" | "Tue 15 Jul"
};

export type PaceResult = {
  eligible: boolean;
  projectedAccuracy: number | null;
  lines: PaceLine[];
  totalWorkHours: number;
  underload: boolean;
};

/** Input to the pure planner — one active assignment. */
export type PaceInput = {
  projectId: string;
  title: string;
  status: ProjectStatus;
  everDelivered: boolean;
  allocatedHours: number | null;
  assignedAt: Date;
};

// ----------------------------- date helpers -----------------------------

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Step `n` working days forward from `anchor`, skipping Sundays. n=0 -> anchor. */
function addWorkingDays(anchor: Date, n: number): Date {
  const d = startOfDay(anchor);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) added++; // 0 = Sunday
  }
  return d;
}

function dayLabel(target: Date, today: Date): string {
  const diffDays = Math.round(
    (startOfDay(target).getTime() - startOfDay(today).getTime()) / 86400000
  );
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 6) return WEEKDAY[target.getDay()];
  return `${WEEKDAY_SHORT[target.getDay()]} ${target.getDate()} ${MONTH_SHORT[target.getMonth()]}`;
}

// ----------------------------- pure planner -----------------------------

/**
 * Pure queue planner. Given active assignments, the worker's projected accuracy,
 * and "now", produce the ordered pace lines. Deterministic and DB-free so it can
 * be unit-tested directly.
 */
export function planPaceLines(
  items: PaceInput[],
  projectedAccuracy: number | null,
  now: Date
): { lines: PaceLine[]; totalWorkHours: number; underload: boolean } {
  const today = startOfDay(now);

  // Queue order: assignment order (asc), stable tie-break on projectId.
  const ordered = [...items].sort((a, b) => {
    const t = a.assignedAt.getTime() - b.assignedAt.getTime();
    return t !== 0 ? t : a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0;
  });

  const ahead = projectedAccuracy != null && projectedAccuracy >= 100;

  const lines: PaceLine[] = [];
  let cum = 0; // cumulative work hours through the queue

  for (const it of ordered) {
    const hours = it.allocatedHours;

    if (hours == null || hours <= 0) {
      lines.push({
        projectId: it.projectId,
        title: it.title,
        kind: "AWAITING_HOURS",
        workHours: 0,
        targetDate: null,
        dayLabel: null,
      });
      continue;
    }

    const isRevision =
      it.status === "REVISION" || (it.status === "IN_PROGRESS" && it.everDelivered);

    if (isRevision && !ahead) {
      // Behind (or no target yet): no fresh time, deliver today. Does not advance
      // the clock, so the rest of the queue stays tight — the built-in overtime push.
      lines.push({
        projectId: it.projectId,
        title: it.title,
        kind: "REVISION_URGENT",
        workHours: 0,
        targetDate: today,
        dayLabel: "today",
      });
      continue;
    }

    const workHours = isRevision
      ? Math.max(1, Math.ceil(hours * REVISION_ALLOWANCE))
      : hours;

    cum += workHours;
    const dayIndex = Math.max(0, Math.ceil(cum / WORK_DAY_HOURS) - 1);
    const target = addWorkingDays(today, dayIndex);

    lines.push({
      projectId: it.projectId,
      title: it.title,
      kind: isRevision ? "REVISION" : "FIRST_PASS",
      workHours,
      targetDate: target,
      dayLabel: dayLabel(target, today),
    });
  }

  const totalWorkHours = lines.reduce((s, l) => s + l.workHours, 0);
  const underload = lines.length > 0 && totalWorkHours < UNDERLOAD_THRESHOLD_HOURS;

  return { lines, totalWorkHours, underload };
}

// --------------------------- DB-backed entry ---------------------------

/**
 * Build the pace card for one onsite worker. Returns { eligible:false } for
 * anyone who isn't an onsite worker with a set monthly target.
 */
export async function buildPaceQueue(
  userId: string,
  now: Date = new Date()
): Promise<PaceResult> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, targetMonthlyPoints: true, joinedAt: true },
  });

  const empty: PaceResult = {
    eligible: false,
    projectedAccuracy: null,
    lines: [],
    totalWorkHours: 0,
    underload: false,
  };

  if (
    !me ||
    me.role !== "ONSITE_EMPLOYEE" ||
    !me.joinedAt ||
    !me.targetMonthlyPoints ||
    me.targetMonthlyPoints <= 0
  ) {
    return empty;
  }

  const mk = monthKeyOf(now);

  // Projected accuracy — mirrors the worker performance page exactly:
  // (finalized credits this month + manual this month + in-flight estimate) / prorated target.
  const [wdMap, creditAgg, manual, est] = await Promise.all([
    getAllWorkingDaysMap(),
    prisma.onsitePointCredit.aggregate({
      where: { userId, monthKey: mk },
      _sum: { points: true },
    }),
    sumManualForUser(userId, { monthKey: mk }),
    getUserEstimatedPoints(userId),
  ]);

  const achievedPoints = (creditAgg._sum.points ?? 0) + manual;
  const target = proratedMonthlyTarget({
    targetMonthlyPoints: me.targetMonthlyPoints,
    joinedAt: me.joinedAt,
    monthKey: mk,
    workingDays: wdMap.get(mk) ?? DEFAULT_WORKING_DAYS,
    now,
  });
  const projectedAccuracy =
    target > 0
      ? Math.round(((achievedPoints + est.totalEstimatedPoints) / target) * 100)
      : null;

  // Active work only: IN_PROGRESS + REVISION, not unassigned, not cancelled.
  // (DELIVERED / COMPLETED / CANCELLED are excluded — out of the worker's hands.)
  const assignments = await prisma.projectAssignment.findMany({
    where: {
      userId,
      unassignedAt: null,
      outcome: { not: "CANCELLED" as any },
      project: { status: { in: ["IN_PROGRESS", "REVISION"] as any } },
    },
    select: {
      assignedAt: true,
      allocatedHours: true,
      project: {
        select: {
          id: true,
          title: true,
          status: true,
          firstDeliveredAt: true,
          firstCompletedAt: true,
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });

  const items: PaceInput[] = assignments.map((a) => {
    const status = a.project.status as ProjectStatus;
    return {
      projectId: a.project.id,
      title: a.project.title,
      status,
      everDelivered: resolveEverDelivered({
        firstDeliveredAt: a.project.firstDeliveredAt,
        firstCompletedAt: a.project.firstCompletedAt,
        status,
      }),
      allocatedHours: a.allocatedHours,
      assignedAt: a.assignedAt,
    };
  });

  const { lines, totalWorkHours, underload } = planPaceLines(
    items,
    projectedAccuracy,
    now
  );

  return { eligible: true, projectedAccuracy, lines, totalWorkHours, underload };
}
