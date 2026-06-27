// app/api/cron/ops-tasks/due-soon/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

const prisma = getPrisma();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Find all PENDING instances that haven't had a due-soon notification yet
  const pendingInstances = await prisma.opsTaskInstance.findMany({
    where: {
      status: "PENDING",
      dueSoonNotifiedAt: null,
      // Only look at instances that have a future dueAt (not already way overdue)
      dueAt: { gt: now },
    },
    select: {
      id: true,
      assigneeId: true,
      title: true,
      timerHours: true,
      dueAt: true,
      createdAt: true,
      assignee: {
        select: { id: true, archivedAt: true },
      },
    },
  });

  let notified = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const instance of pendingInstances) {
    try {
      // Skip archived assignees
      if (instance.assignee.archivedAt) {
        skipped++;
        continue;
      }

      const totalMs = instance.timerHours * 60 * 60 * 1000;
      const elapsedMs = now.getTime() - instance.createdAt.getTime();
      const remainingMs = instance.dueAt.getTime() - now.getTime();

      // Trigger when 80% or more of the time has elapsed (20% or less remaining)
      const threshold = totalMs * 0.8;
      if (elapsedMs < threshold) {
        skipped++;
        continue;
      }

      const remainingHours = Math.round(remainingMs / (1000 * 60 * 60));
      const remainingLabel =
        remainingHours < 1 ? "less than an hour" : `${remainingHours} hour${remainingHours === 1 ? "" : "s"}`;

      await notify({
        type: "TASK_DUE_SOON",
        actorId: null,
        title: `Task due soon: ${instance.title}`,
        body: `You have ${remainingLabel} remaining to complete this task.`,
        href: "/app/ops-tasks",
        recipients: { kind: "SPECIFIC_USERS", userIds: [instance.assigneeId] },
      });

      // Mark notified so we don't fire again
      await prisma.opsTaskInstance.update({
        where: { id: instance.id },
        data: { dueSoonNotifiedAt: now },
      });

      notified++;
    } catch (err: any) {
      errors.push(`Instance ${instance.id}: ${String(err?.message ?? err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    notified,
    skipped,
    errors,
    ranAt: now.toISOString(),
  });
}