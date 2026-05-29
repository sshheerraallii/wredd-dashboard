// app/api/cron/ops-tasks/generate/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

const prisma = getPrisma();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Guard: only allow calls from Vercel Cron (or your own CRON_SECRET)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const todayDayNumber = now.getDay();

  // Deadline starts from midnight of the current day
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Find all active recurring tasks where today's day is in runOnDays
  const recurringTasks = await prisma.opsTask.findMany({
    where: {
      type: "RECURRING",
      isActive: true,
    },
    include: {
      assignee: {
        select: { id: true, fullName: true, archivedAt: true },
      },
    },
  });

  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const task of recurringTasks) {
    try {
      // Skip if assignee is archived
      if (task.assignee.archivedAt) {
        skipped++;
        continue;
      }

      // Skip if today is not in the task's runOnDays schedule
      if (!task.runOnDays.includes(todayDayNumber)) {
        skipped++;
        continue;
      }

      // Guard: don't create a duplicate if one was already generated today
      // (protects against cron running twice due to retries)
      const existingToday = await prisma.opsTaskInstance.findFirst({
        where: {
          taskId: task.id,
          createdAt: { gte: startOfToday },
        },
        select: { id: true },
      });

      if (existingToday) {
        skipped++;
        continue;
      }

      const dueAt = new Date(now.getTime() + task.timerHours * 60 * 60 * 1000);

      await prisma.opsTaskInstance.create({
        data: {
          taskId: task.id,
          assigneeId: task.assigneeId,
          title: task.title,
          timerHours: task.timerHours,
          dueAt,
          originalDueAt: dueAt,
          status: "PENDING",
        },
      });

      // Notify the assignee in-app + email
      await notify({
        type: "TASK_ASSIGNED",
        actorId: null,
        title: `Daily task: ${task.title}`,
        body: `Due in ${task.timerHours} hour${task.timerHours === 1 ? "" : "s"}.`,
        href: "/app/ops-tasks",
        recipients: { kind: "SPECIFIC_USERS", userIds: [task.assigneeId] },
      });

      generated++;
    } catch (err: any) {
      errors.push(`Task ${task.id}: ${String(err?.message ?? err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    generated,
    skipped,
    errors,
    ranAt: now.toISOString(),
    dayOfWeek: todayDayNumber,
  });
}