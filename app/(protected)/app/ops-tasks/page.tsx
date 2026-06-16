// app/(protected)/app/ops-tasks/page.tsx

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { EmployeeOpsTasksClient } from "./_components/employee-ops-tasks-client";

const prisma = getPrisma();

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export default async function OpsTasksPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await readSession();
  const user = session?.user as any;
  if (!user) redirect("/login");

  const role = user.role as string;
  if (
    role !== "SUPER_ADMIN" &&
    role !== "MANAGER" &&
    role !== "BUSINESS_DEVELOPER"
  ) {
    redirect("/app/projects?err=forbidden");
  }

  const tab = String(searchParams.tab ?? "pending");
  const now = new Date();
  const fromDate = startOfMonth(now);

  // ── Fetch this user's instances ───────────────────────────────────────────
  const allInstances = await prisma.opsTaskInstance.findMany({
    where: { assigneeId: user.id },
    include: {
      task: { select: { id: true, type: true, description: true } },
      reopenedBy: { select: { id: true, fullName: true } },
      deadlineExtendedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const pending = allInstances.filter((i) => i.status === "PENDING");
  const completed = allInstances.filter((i) => i.status === "COMPLETED");

  // ── Commitment score for this month ───────────────────────────────────────
  const monthInstances = allInstances.filter(
    (i) => i.createdAt >= fromDate && i.createdAt <= now
  );
  const totalPossible = monthInstances.length * 10;
  const totalEarned = monthInstances.reduce(
    (sum, i) => sum + (i.points ?? 0),
    0
  );
  const commitmentPct =
    totalPossible > 0
      ? Math.round((totalEarned / totalPossible) * 100)
      : 100;
  const doneCount = monthInstances.filter(
    (i) => i.status === "COMPLETED"
  ).length;
  const lateCount = monthInstances.filter(
    (i) =>
      i.status === "COMPLETED" &&
      i.completedAt != null &&
      i.completedAt > i.dueAt
  ).length;
  const pendingThisMonth = monthInstances.filter(
    (i) => i.status === "PENDING"
  ).length;

  const serialize = (instances: typeof allInstances) =>
    instances.map((i) => ({
      ...i,
      dueAt: i.dueAt.toISOString(),
      originalDueAt: i.originalDueAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
      completedAt: i.completedAt?.toISOString() ?? null,
      deadlineExtendedAt: i.deadlineExtendedAt?.toISOString() ?? null,
      reopenedAt: i.reopenedAt?.toISOString() ?? null,
    }));

  return (
    <EmployeeOpsTasksClient
      initialTab={tab}
      pending={serialize(pending)}
      completed={serialize(completed)}
      score={{
        commitmentPct,
        totalPossible,
        totalEarned,
        taskCount: monthInstances.length,
        doneCount,
        lateCount,
        pendingCount: pendingThisMonth,
      }}
      userName={user.name ?? user.fullName ?? ""}
    />
  );
}