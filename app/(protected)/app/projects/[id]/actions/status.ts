// app/(protected)/app/projects/[id]/actions/status.ts
"use server";

import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { requireRole } from "@/lib/guards";
import { notify } from "@/lib/notify";
import { upsertBdCommissionForProject } from "@/lib/bd-commission/upsert-bd-commission";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

type ProjectStatus =
  | "UNASSIGNED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "REVISION"
  | "COMPLETED"
  | "CANCELLED";

function secondsBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

function shouldPauseOnStatus(s: ProjectStatus) {
  return s === "DELIVERED" || s === "COMPLETED" || s === "CANCELLED";
}

function shouldRunOnStatus(s: ProjectStatus) {
  return s === "IN_PROGRESS" || s === "REVISION";
}

function isWorker(role: Role | undefined) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

function isAdminish(role: Role | undefined) {
  return role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";
}

function canSetDelivered(role: Role | undefined) {
  // BD/Manager cannot set DELIVERED
  return role === "SUPER_ADMIN" || role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

function backWithError(projectId: string, msg: string) {
  redirect(`/app/projects/${projectId}?err=${encodeURIComponent(msg)}`);
}

function label(s: ProjectStatus) {
  return s.replace(/_/g, " ");
}

// "COMPLETED only from DELIVERED"
function isAllowedTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true;

  switch (from) {
    case "UNASSIGNED":
      return to === "CANCELLED" || to === "IN_PROGRESS";

    case "IN_PROGRESS":
      return to === "DELIVERED" || to === "REVISION" || to === "CANCELLED";

    case "DELIVERED":
      return to === "COMPLETED" || to === "REVISION" || to === "IN_PROGRESS" || to === "CANCELLED";

    case "REVISION":
      return to === "DELIVERED" || to === "IN_PROGRESS" || to === "CANCELLED";

    case "COMPLETED":
      return to === "REVISION" || to === "IN_PROGRESS" || to === "CANCELLED";

    case "CANCELLED":
      return to === "IN_PROGRESS" || to === "CANCELLED";

    default:
      return false;
  }
}

/**
 * Payment policy:
 * - Payable on the 10th of the next month after firstCompletedAt
 */
function payableOnFrom(firstCompletedAt: Date) {
  const y = firstCompletedAt.getFullYear();
  const m = firstCompletedAt.getMonth(); // 0-based
  return new Date(y, m + 1, 10, 0, 0, 0, 0);
}

export async function setProjectStatus(args: {
  projectId: string;
  nextStatus: ProjectStatus;
  note?: string;
  /** Per-worker lateness set by manager at completion time.
   *  hoursLate = 0 means on time. Stored on ProjectAssignment for commitment scoring. */
  workerLateness?: { userId: string; hoursLate: number }[];
}) {
  await requireRole([
    "SUPER_ADMIN",
    "MANAGER",
    "BUSINESS_DEVELOPER",
    "REMOTE_WORKER",
    "ONSITE_EMPLOYEE",
  ]);

  const { projectId, nextStatus } = args;
  const note = (args.note || "").trim();

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const userId = session.user.id;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      firstCompletedAt: true,
      timerRunning: true,
      timerLastResumedAt: true,
      timerAccumulatedSeconds: true,
    },
  });

  if (!project) backWithError(projectId, "Project not found.");

  const prevStatus = project.status as ProjectStatus;

  // ----- RBAC -----
  if (isWorker(role)) {
    if (nextStatus !== "DELIVERED") {
      backWithError(projectId, "Forbidden: workers can only set DELIVERED.");
    }

    const activeAssignment = await prisma.projectAssignment.findFirst({
      where: { projectId, userId, unassignedAt: null },
      select: { id: true },
    });

    if (!activeAssignment) {
      backWithError(projectId, "Forbidden: you are not actively assigned to this project.");
    }
  } else {
    if (!isAdminish(role)) backWithError(projectId, "Forbidden.");
  }

  if (nextStatus === "DELIVERED" && !canSetDelivered(role)) {
    backWithError(projectId, "Forbidden: only workers (or Super Admin) can set DELIVERED.");
  }

  if (nextStatus === "REVISION" && note.length < 3) {
    backWithError(projectId, "REVISION requires a message.");
  }

  if (nextStatus === "COMPLETED" && prevStatus !== "DELIVERED") {
    backWithError(projectId, "Project must be DELIVERED before it can be COMPLETED.");
  }

  if (!isAllowedTransition(prevStatus, nextStatus)) {
    backWithError(projectId, `Invalid transition: ${label(prevStatus)} → ${label(nextStatus)}`);
  }

  if (!isWorker(role) && nextStatus === "UNASSIGNED") {
    backWithError(projectId, "UNASSIGNED is controlled by assignments, not manual status changes.");
  }

  // ✅ We compute commission AFTER the transaction commits
  // ✅ But we want it whenever we land on COMPLETED (not only first completion)
  const shouldUpsertCommission = nextStatus === "COMPLETED";

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        firstCompletedAt: true,
        remotePrice: true, // legacy fallback only
        timerRunning: true,
        timerLastResumedAt: true,
        timerAccumulatedSeconds: true,
      },
    });
    if (!fresh) backWithError(projectId, "Project not found.");

    const now = new Date();

    const activeAssignments = await tx.projectAssignment.findMany({
      where: { projectId, unassignedAt: null },
      select: { userId: true, outcome: true },
      orderBy: { assignedAt: "asc" },
    });
    const activeUserIds = activeAssignments.map((a) => a.userId);
    const hasActiveAssignments = activeUserIds.length > 0;

    const timerPatch: {
      timerRunning?: boolean;
      timerLastResumedAt?: Date | null;
      timerAccumulatedSeconds?: number;
    } = {};

    if (shouldPauseOnStatus(nextStatus)) {
      if (fresh.timerRunning && fresh.timerLastResumedAt) {
        const add = secondsBetween(now, fresh.timerLastResumedAt);
        timerPatch.timerAccumulatedSeconds = fresh.timerAccumulatedSeconds + add;
      }
      timerPatch.timerRunning = false;
      timerPatch.timerLastResumedAt = null;
    }

    if (shouldRunOnStatus(nextStatus)) {
      if (hasActiveAssignments) {
        if (!fresh.timerRunning) {
          timerPatch.timerRunning = true;
          timerPatch.timerLastResumedAt = now;
        }
      } else {
        timerPatch.timerRunning = false;
        timerPatch.timerLastResumedAt = null;
      }
    }

    const isFirstCompletion = nextStatus === "COMPLETED" && !fresh.firstCompletedAt;
    const completionAt = isFirstCompletion ? now : fresh.firstCompletedAt ?? null;

    const completionPatch: { firstCompletedAt?: Date } = {};
    if (isFirstCompletion) completionPatch.firstCompletedAt = now;

    await tx.project.update({
      where: { id: projectId },
      data: {
        status: nextStatus,
        statusChangedAt: now,
        cancelledAt: nextStatus === "CANCELLED" ? now : null,
        ...timerPatch,
        ...completionPatch,
      },
    });

    // ==========================
    // ASSIGNMENT OUTCOME ENGINE (standalone)
    // Rule:
    // - When project becomes COMPLETED: only active (unassignedAt=null) assignments become COMPLETED
    // - CANCELLED assignments remain CANCELLED forever
    // - This does NOT affect Project.status and does not reopen outcomes
    // ==========================
    if (nextStatus === "COMPLETED") {
      await tx.projectAssignment.updateMany({
        where: {
          projectId,
          unassignedAt: null,
          // do NOT overwrite cancelled-for-worker assignments
          outcome: { not: "CANCELLED" as any },
        } as any,
        data: {
          outcome: "COMPLETED" as any,
          completedAt: now,
        } as any,
      });

      // Save per-worker lateness from manager input at completion time.
      // hoursLate = 0 means on time; >0 means late by N hours.
      // null (not set) means auto-calc from timer will be used in scoring.
      if (args.workerLateness && args.workerLateness.length > 0) {
        for (const { userId: wId, hoursLate } of args.workerLateness) {
          await tx.projectAssignment.updateMany({
            where: {
              projectId,
              userId: wId,
              unassignedAt: null,
            },
            data: { hoursLate } as any,
          });
        }
      }
    }

    // ==========================
    // PAYMENTS
    // ==========================

    // A) If cancelling before first completion: void all UNPAID lines
    if (nextStatus === "CANCELLED" && !fresh.firstCompletedAt) {
      await tx.projectPaymentLine.updateMany({
        where: { projectId, status: "UNPAID" as any },
        data: { status: "VOIDED" as any },
      });
    }

    // B) On first completion: set payableOn to pay date (10th next month)
    if (isFirstCompletion) {
      const payableOn = payableOnFrom(completionAt ?? now);

      if (activeUserIds.length) {
        await tx.projectPaymentLine.updateMany({
          where: {
            projectId,
            userId: { in: activeUserIds },
            status: "UNPAID" as any,
          } as any,
          data: { payableOn },
        });
      }

      // Legacy fallback: if no lines exist yet, create from active assignments
      const lineCount = await tx.projectPaymentLine.count({ where: { projectId } });
      if (lineCount === 0 && fresh.remotePrice && activeUserIds.length) {
        const users = await tx.user.findMany({
          where: { id: { in: activeUserIds } },
          select: { id: true, role: true, archivedAt: true },
        });

        const payees = users.filter((u) => u.archivedAt == null && u.role === "REMOTE_WORKER");
        if (payees.length) {
          const total = fresh.remotePrice;
          const share = total.div(payees.length);

          for (const u of payees) {
            await tx.projectPaymentLine.create({
              data: {
                projectId,
                userId: u.id,
                amount: share,
                payableOn,
                status: "UNPAID" as any,
              } as any,
            });
          }
        }
      }
    }

    if (nextStatus === "REVISION") {
      await tx.projectMessage.create({
        data: {
          projectId,
          type: "REVISION_REQUEST",
          content: note,
          createdById: userId,
          meta: { from: prevStatus, to: nextStatus },
        },
      });
    }

    await tx.projectMessage.create({
      data: {
        projectId,
        type: "STATUS_CHANGE",
        content:
          nextStatus === "CANCELLED" && note
            ? `Status changed: ${label(prevStatus)} → ${label(nextStatus)} • ${note}`
            : `Status changed: ${label(prevStatus)} → ${label(nextStatus)}`,
        meta: { from: prevStatus, to: nextStatus, isFirstCompletion },
        createdById: userId,
      },
    });

    await tx.projectActivity.create({
      data: {
        projectId,
        actorId: userId,
        action: "STATUS_CHANGE",
        data: {
          from: prevStatus,
          to: nextStatus,
          isFirstCompletion,
          note: note || undefined,
        },
      },
    });
  });

  // ✅ Run commission engine AFTER transaction commit
  // ✅ Run whenever project becomes COMPLETED (so onsite hours/rate changes can be reflected)
  if (shouldUpsertCommission) {
    await upsertBdCommissionForProject(projectId);
  }

  const title = `Project status updated: ${label(prevStatus)} → ${label(nextStatus)}`;

  await notify({
    type:
      nextStatus === "COMPLETED"
        ? "PROJECT_COMPLETED"
        : nextStatus === "CANCELLED"
        ? "PROJECT_CANCELLED"
        : "PROJECT_STATUS_CHANGED",
    projectId,
    actorId: userId,
    title,
    body: `Status changed by ${role ?? "user"}.`,
    href: `/app/projects/${projectId}`,
    recipients: { kind: "PROJECT_AUDIENCE" },
  });

  redirect(`/app/projects/${projectId}?ok=${encodeURIComponent("Status updated")}`);
}