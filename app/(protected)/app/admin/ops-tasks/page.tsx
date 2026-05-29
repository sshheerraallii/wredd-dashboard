// app/(protected)/app/admin/ops-tasks/page.tsx

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { AdminOpsTasksClient } from "./_components/admin-ops-tasks-client";

const prisma = getPrisma();

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfLastMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1, 0, 0, 0, 0);
}
function endOfLastMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
}

export default async function AdminOpsTasksPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await readSession();
  const user = session?.user as any;
  if (!user) redirect("/login");

  const role = user.role as string;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app/projects?err=forbidden");
  }

  const isSuperAdmin = role === "SUPER_ADMIN";

  const tab = String(searchParams.tab ?? "tasks");
  const statusFilter = String(searchParams.status ?? "pending") as
    | "pending"
    | "completed";
  const assigneeFilter = String(searchParams.assigneeId ?? "");
  const perfRange = String(searchParams.range ?? "month");

  // ── Parse custom date range ──────────────────────────────────────────────
  const now = new Date();
  let fromDate: Date;
  let toDate: Date;

  if (perfRange === "last") {
    fromDate = startOfLastMonth(now);
    toDate = endOfLastMonth(now);
  } else if (
    perfRange === "custom" &&
    searchParams.from &&
    searchParams.to
  ) {
    fromDate = new Date(String(searchParams.from));
    toDate = new Date(String(searchParams.to));
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      fromDate = startOfMonth(now);
      toDate = now;
    }
  } else {
    fromDate = startOfMonth(now);
    toDate = now;
  }

  // ── Fetch ops-eligible users for the assignee dropdown ───────────────────
  const opsUsers = await prisma.user.findMany({
    where: {
      archivedAt: null,
      role: {
        in: ["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"],
      },
    },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });

  // ── Fetch task instances ─────────────────────────────────────────────────
  const instancesWhere: any = {
    status: statusFilter === "pending" ? "PENDING" : "COMPLETED",
    ...(assigneeFilter ? { assigneeId: assigneeFilter } : {}),
  };

  const instances = await prisma.opsTaskInstance.findMany({
    where: instancesWhere,
    include: {
      assignee: { select: { id: true, fullName: true, role: true } },
      task: { select: { id: true, type: true, description: true, runOnDays: true } },
      deadlineExtendedBy: { select: { id: true, fullName: true } },
      reopenedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── Fetch performance data ────────────────────────────────────────────────
  const perfInstances = await prisma.opsTaskInstance.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
    },
    include: {
      assignee: { select: { id: true, fullName: true, role: true } },
    },
  });

  // Group by assignee
  const perfMap = new Map<
    string,
    {
      user: { id: string; fullName: string; role: string };
      instances: typeof perfInstances;
    }
  >();
  for (const inst of perfInstances) {
    if (!perfMap.has(inst.assigneeId)) {
      perfMap.set(inst.assigneeId, { user: inst.assignee, instances: [] });
    }
    perfMap.get(inst.assigneeId)!.instances.push(inst);
  }

  const performance = Array.from(perfMap.values())
    .map(({ user, instances }) => {
      const totalPossible = instances.length * 10;
      const totalEarned = instances.reduce(
        (sum, i) => sum + (i.points ?? 0),
        0
      );
      const commitmentPct =
        totalPossible > 0
          ? Math.round((totalEarned / totalPossible) * 100)
          : 100;
      const doneCount = instances.filter(
        (i) => i.status === "COMPLETED"
      ).length;
      const lateCount = instances.filter(
        (i) =>
          i.status === "COMPLETED" &&
          i.completedAt != null &&
          i.completedAt > i.originalDueAt
      ).length;
      const pendingCount = instances.filter(
        (i) => i.status === "PENDING"
      ).length;
      return {
        user,
        totalPossible,
        totalEarned,
        commitmentPct,
        taskCount: instances.length,
        doneCount,
        lateCount,
        pendingCount,
      };
    })
    .sort((a, b) => b.commitmentPct - a.commitmentPct);

  // Overall summary stats
  const allThisMonth = await prisma.opsTaskInstance.findMany({
    where: { createdAt: { gte: fromDate, lte: toDate } },
    select: { status: true, points: true, completedAt: true, originalDueAt: true },
  });
  const totalAssigned = allThisMonth.length;
  const totalCompleted = allThisMonth.filter(
    (i) => i.status === "COMPLETED"
  ).length;
  const totalOnTime = allThisMonth.filter(
    (i) =>
      i.status === "COMPLETED" &&
      i.completedAt != null &&
      i.completedAt <= i.originalDueAt
  ).length;
  const totalPending = allThisMonth.filter(
    (i) => i.status === "PENDING"
  ).length;

  const pendingCount = instances.filter((i) => i.status === "PENDING").length;
  const completedCount = instances.filter(
    (i) => i.status === "COMPLETED"
  ).length;

  return (
    <AdminOpsTasksClient
      isSuperAdmin={isSuperAdmin}
      actorId={user.id}
      opsUsers={opsUsers}
      instances={instances.map((i) => ({
        ...i,
        dueAt: i.dueAt.toISOString(),
        originalDueAt: i.originalDueAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
        completedAt: i.completedAt?.toISOString() ?? null,
        deadlineExtendedAt: i.deadlineExtendedAt?.toISOString() ?? null,
        reopenedAt: i.reopenedAt?.toISOString() ?? null,
      }))}
      pendingCount={pendingCount}
      completedCount={completedCount}
      performance={performance}
      perfSummary={{ totalAssigned, totalCompleted, totalOnTime, totalPending }}
      initialTab={tab}
      initialStatus={statusFilter}
      initialAssigneeFilter={assigneeFilter}
      initialPerfRange={perfRange}
      initialFrom={searchParams.from ? String(searchParams.from) : ""}
      initialTo={searchParams.to ? String(searchParams.to) : ""}
    />
  );
}