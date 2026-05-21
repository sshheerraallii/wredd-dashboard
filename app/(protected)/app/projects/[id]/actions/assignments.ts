// app/(protected)/app/projects/[id]/actions/assignments.ts
"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/guards";
import { notify } from "@/lib/notify";

const prisma = getPrisma();

function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app?err=forbidden");
  }
}

const AssignSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.string().optional(), // decimal string (REMOTE only) -> worker payout
  allocatedHours: z.coerce.number().int().min(1).max(100000).optional(), // ONSITE only — per worker
});

const UnassignSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
});

const UpdateSplitSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.string().min(1),
});

async function writeSystemMessage(
  tx: PrismaClient,
  projectId: string,
  content: string,
  actorId?: string
) {
  await tx.projectMessage.create({
    data: {
      projectId,
      createdById: actorId ?? null,
      type: "SYSTEM",
      content,
    },
  });

  await tx.projectActivity.create({
    data: {
      projectId,
      actorId: actorId ?? null,
      action: "ASSIGNMENT",
      data: { content },
    },
  });
}

/**
 * Pay date policy:
 * - PayableOn is the 10th of the next month after firstCompletedAt
 */
function payableOnFrom(firstCompletedAt: Date) {
  const y = firstCompletedAt.getFullYear();
  const m = firstCompletedAt.getMonth();
  return new Date(y, m + 1, 10, 0, 0, 0, 0);
}

// payableOn is nullable — only set once firstCompletedAt exists





function payableOnPlaceholder() {
  return new Date(0);
}

function parseMoney(input: string) {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return new Prisma.Decimal(s);
}

function backWithError(projectId: string, msg: string) {
  redirect(`/app/projects/${projectId}?err=${encodeURIComponent(msg)}`);
}

async function getActor() {
  const session = await readSession();
  requireManagerOrAdmin((session?.user as any)?.role);
  return {
    actorId: ((session?.user as any)?.id as string | undefined) ?? undefined,
    actorRole: (session?.user as any)?.role as string | undefined,
  };
}

async function notifyAssignees({
  type,
  projectId,
  actorId,
  title,
  body,
}: {
  type: Parameters<typeof notify>[0]["type"];
  projectId: string;
  actorId: string | null;
  title: string;
  body: string;
}) {
  await notify({
    type,
    projectId,
    actorId,
    title,
    body,
    href: `/app/projects/${projectId}`,
    recipients: { kind: "PROJECT_ASSIGNEES_ACTIVE" },
  });
}

/**
 * Centralized status update:
 * - ALWAYS sets statusChangedAt
 * - ALWAYS clears cancelledAt when moving to active states
 */
async function setProjectStatus(
  tx: PrismaClient,
  projectId: string,
  status: "IN_PROGRESS" | "UNASSIGNED" | "DELIVERED" | "COMPLETED" | "CANCELLED"
) {
  const base: any = {
    status,
    statusChangedAt: new Date(),
  };

  if (
    status === "IN_PROGRESS" ||
    status === "UNASSIGNED" ||
    status === "DELIVERED" ||
    status === "COMPLETED"
  ) {
    base.cancelledAt = null;
  }

  await tx.project.update({
    where: { id: projectId },
    data: base,
  });
}

/**
 * Ensure ProjectFinance exists (older projects may not have it)
 */
async function ensureProjectFinance(tx: PrismaClient, projectId: string) {
  const existing = await tx.projectFinance.findUnique({
    where: { projectId },
    select: { id: true },
  });
  if (existing) return;

  await tx.projectFinance.create({
    data: {
      projectId,
      // safe defaults; super admin/BD can fill pricing later
      workType: "REMOTE",
      portal: "OTHER",
      priceUsd: new Prisma.Decimal("0.00"),
      platformFeePercent: null,
      allowedHours: null,
      clientName: null,
      clientUsername: null,
    } as any,
  });
}

/**
 * Auto-sync ProjectFinance.workType based on active assignments (before firstCompletedAt)
 * Rule:
 * - If any active ONSITE_EMPLOYEE => ONSITE
 * - Else if any active REMOTE_WORKER => REMOTE
 * - Else (no active) leave unchanged
 *
 * If switching to ONSITE, allowedHours must be provided or already exist.
 */


async function syncFinanceWorkTypeFromAssignments(
  tx: PrismaClient,
  projectId: string
) {
  const proj = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, firstCompletedAt: true },
  });
  if (!proj) return;

  // freeze after first completion
  if (proj.firstCompletedAt) return;

  await ensureProjectFinance(tx, projectId);

  const active = await tx.projectAssignment.findMany({
    where: { projectId, unassignedAt: null },
    select: { user: { select: { role: true } }, allocatedHours: true },
  });

  const hasOnsite = active.some((a) => a.user.role === "ONSITE_EMPLOYEE");
  const hasRemote = active.some((a) => a.user.role === "REMOTE_WORKER");

  if (!hasOnsite && !hasRemote) return;

  if (hasOnsite) {
    // Sum allocatedHours across all active onsite assignments
    const totalHours = active
      .filter((a) => a.user.role === "ONSITE_EMPLOYEE")
      .reduce((sum, a) => sum + (a.allocatedHours ?? 0), 0);

    await tx.projectFinance.update({
      where: { projectId },
      data: {
        workType: "ONSITE",
        allowedHours: totalHours > 0 ? totalHours : null,
      } as any,
    });
  } else if (hasRemote) {
    await tx.projectFinance.update({
      where: { projectId },
      data: {
        workType: "REMOTE",
        allowedHours: null,
      } as any,
    });
  }
}


/**
 * Keep legacy Project.remotePrice synced from payment lines (worker payouts)
 * This does NOT affect BD commission (commission uses ProjectFinance.priceUsd).
 *
 * We sum the latest non-voided line per user (distinct userId, newest).
 */
async function syncLegacyRemotePriceFromLines(tx: PrismaClient, projectId: string) {
  const latestPerUser = await tx.projectPaymentLine.findMany({
    where: { projectId, status: { not: "VOIDED" as any } } as any,
    orderBy: { createdAt: "desc" },
    distinct: ["userId"],
    select: { amount: true },
  });

  let sum = new Prisma.Decimal("0.00");
  for (const r of latestPerUser) {
    sum = sum.add(new Prisma.Decimal(r.amount as any));
  }

  await tx.project.update({
    where: { id: projectId },
    data: { remotePrice: sum },
  });
}

export async function assignWorkerToProject(input: z.infer<typeof AssignSchema>) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const { actorId } = await getActor();

  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) redirect("/app/projects?err=invalid_input");

 const { projectId, userId, amount, allocatedHours } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      timerRunning: true,
      firstCompletedAt: true,
      remotePrice: true, // legacy
    },
  });
  if (!project) redirect("/app/projects?err=project_not_found");

  const userRec = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, archivedAt: true, role: true, workerType: true },
  });
  if (!userRec) redirect(`/app/projects/${projectId}?err=user_not_found`);
  if (userRec.archivedAt) redirect(`/app/projects/${projectId}?err=user_archived`);

  const isRemote = userRec.role === "REMOTE_WORKER";

  // If remote: amount required (worker payout)
  let money: Prisma.Decimal | null = null;
  if (isRemote) {
    if (!amount || !amount.trim()) redirect(`/app/projects/${projectId}?err=payment_required`);
    money = parseMoney(amount);
    if (!money) redirect(`/app/projects/${projectId}?err=invalid_payment_amount`);
  } else {
    // onsite: allocatedHours required per worker (used in BD commission overhead)
    if (!allocatedHours || allocatedHours < 1) {
      redirect(`/app/projects/${projectId}?err=allocated_hours_required_for_onsite`);
    }
  }

  await prisma.$transaction(async (tx) => {
    // assignment upsert
    await tx.projectAssignment.upsert({
      where: { projectId_userId: { projectId, userId } },
     create: {
        projectId,
        userId,
        assignedById: actorId ?? null,
        assignedAt: new Date(),
        unassignedAt: null,

        // ✅ reset outcome on first assign
        outcome: "ACTIVE" as any,
        cancelledForWorkerAt: null,
        completedAt: null,

        // ✅ per-worker hours (onsite only)
        allocatedHours: isRemote ? null : (allocatedHours ?? null),
      },
      update: {
        assignedById: actorId ?? null,
        unassignedAt: null,

        // ✅ if previously cancelled, re-activating clears it
        outcome: "ACTIVE" as any,
        cancelledForWorkerAt: null,

        // ✅ update hours in case admin is re-assigning with a different value
        allocatedHours: isRemote ? null : (allocatedHours ?? null),
      },
    });

    const activeCount = await tx.projectAssignment.count({
      where: { projectId, unassignedAt: null },
    });

    // status: UNASSIGNED -> IN_PROGRESS (with statusChangedAt)
    if (activeCount > 0 && project.status === "UNASSIGNED") {
      await setProjectStatus(tx, projectId, "IN_PROGRESS");
    }

    // timer: auto start/resume
    if (activeCount > 0 && !project.timerRunning) {
      await tx.project.update({
        where: { id: projectId },
        data: {
          timerRunning: true,
          timerLastResumedAt: new Date(),
        },
      });
    }

    // payment line logic (remote only)
    if (isRemote && money) {
      const payableOn = project.firstCompletedAt
        ? payableOnFrom(project.firstCompletedAt)
        : payableOnPlaceholder();

      const existing = await tx.projectPaymentLine.findFirst({
        where: { projectId, userId },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      });

      if (!existing) {
        await tx.projectPaymentLine.create({
          data: {
            projectId,
            userId,
            amount: money,
            payableOn,
            status: "UNPAID",
          },
        });
      } else {
        if (existing.status !== "PAID" && existing.status !== "EXCEPTION_PAID") {
          await tx.projectPaymentLine.update({
            where: { id: existing.id },
            data: {
              status: "UNPAID",
              amount: money,
              payableOn,
            },
          });
        }
      }

      // keep legacy project.remotePrice synced
      await syncLegacyRemotePriceFromLines(tx, projectId);
    }

   // ✅ Auto workType from assignments (before firstCompletedAt)
    await syncFinanceWorkTypeFromAssignments(tx, projectId);

    await writeSystemMessage(
      tx,
      projectId,
      isRemote
        ? `Assigned: ${userRec.fullName} (REMOTE) • Payment: ${money?.toString()}`
        : `Assigned: ${userRec.fullName} (ONSITE) • Allocated hours: ${allocatedHours}`,
      actorId
    );
  });

  await notifyAssignees({
    type: "ASSIGNMENT_ADDED",
    projectId,
    actorId: actorId ?? null,
    title: "You were assigned to a project",
    body: `Assigned by admin/manager.`,
  });

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
}



export async function unassignWorkerFromProject(input: z.infer<typeof UnassignSchema>) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const { actorId } = await getActor();

  const parsed = UnassignSchema.safeParse(input);
  if (!parsed.success) redirect("/app/projects?err=invalid_input");

  const { projectId, userId } = parsed.data;

  const userRec = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, role: true, archivedAt: true },
  });
  if (!userRec) redirect(`/app/projects/${projectId}?err=user_not_found`);

  await prisma.$transaction(async (tx) => {
    const assignment = await tx.projectAssignment.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { unassignedAt: true },
    });

    if (!assignment) redirect(`/app/projects/${projectId}?err=assignment_not_found`);

    if (!assignment.unassignedAt) {
      await tx.projectAssignment.update({
        where: { projectId_userId: { projectId, userId } },
        data: {
          unassignedAt: new Date(),
          outcome: "REMOVED" as any, // manager removed, not a worker cancellation
        },
      });
    } 

    // Payment disappearance rule (remote only, unpaid only)
    if (userRec.archivedAt == null && userRec.role === "REMOTE_WORKER") {
      const line = await tx.projectPaymentLine.findFirst({
        where: { projectId, userId },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      });

      if (line && line.status === "UNPAID") {
        await tx.projectPaymentLine.update({
          where: { id: line.id },
          data: { status: "VOIDED" },
        });
      }

      // keep legacy project.remotePrice synced
      await syncLegacyRemotePriceFromLines(tx, projectId);
    }

    const activeCount = await tx.projectAssignment.count({
      where: { projectId, unassignedAt: null },
    });

    if (activeCount === 0) {
      // status: -> UNASSIGNED (with statusChangedAt)
      await setProjectStatus(tx, projectId, "UNASSIGNED");

      // stop timer
      await tx.project.update({
        where: { id: projectId },
        data: {
          timerRunning: false,
          timerLastResumedAt: null,
        },
      });
    }

    // ✅ Auto workType from assignments (before firstCompletedAt)
    await syncFinanceWorkTypeFromAssignments(tx, projectId);

    await writeSystemMessage(tx, projectId, `Unassigned: ${userRec.fullName}`, actorId);
  });

  await notifyAssignees({
    type: "ASSIGNMENT_REMOVED",
    projectId,
    actorId: actorId ?? null,
    title: "You were unassigned from a project",
    body: `Unassigned by admin/manager.`,
  });

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
}

/**
 * NEW: Unassign & Cancel (for worker)
 * - Always ends assignment (sets unassignedAt if needed)
 * - Sets outcome=CANCELLED + cancelledForWorkerAt=now (does NOT touch completedAt)
 * - Keeps remote unpaid payment disappearance rule + legacy remotePrice sync
 * - If no active assignments remain: set UNASSIGNED and stop timer
 * - Sync finance workType before firstCompletedAt
 * - Writes system message
 */
export async function unassignAndCancelForWorker(input: z.infer<typeof UnassignSchema>) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const { actorId } = await getActor();

  const parsed = UnassignSchema.safeParse(input);
  if (!parsed.success) redirect("/app/projects?err=invalid_input");

  const { projectId, userId } = parsed.data;

  const userRec = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, role: true, archivedAt: true },
  });
  if (!userRec) redirect(`/app/projects/${projectId}?err=user_not_found`);

  await prisma.$transaction(async (tx) => {
    const assignment = await tx.projectAssignment.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { unassignedAt: true, outcome: true },
    });

    if (!assignment) redirect(`/app/projects/${projectId}?err=assignment_not_found`);

    // ✅ Always end assignment (if not already)
    if (!assignment.unassignedAt) {
      await tx.projectAssignment.update({
        where: { projectId_userId: { projectId, userId } },
        data: { unassignedAt: new Date() },
      });
    }

    // ✅ Mark cancelled-for-worker (standalone)
    await tx.projectAssignment.update({
      where: { projectId_userId: { projectId, userId } },
      data: {
        outcome: "CANCELLED" as any,
        cancelledForWorkerAt: new Date(),
        // do NOT touch completedAt here
      },
    });

    // Payment disappearance rule (remote only, unpaid only) — same as normal unassign
    if (userRec.archivedAt == null && userRec.role === "REMOTE_WORKER") {
      const line = await tx.projectPaymentLine.findFirst({
        where: { projectId, userId },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      });

      if (line && line.status === "UNPAID") {
        await tx.projectPaymentLine.update({
          where: { id: line.id },
          data: { status: "VOIDED" },
        });
      }

      await syncLegacyRemotePriceFromLines(tx, projectId);
    }

    const activeCount = await tx.projectAssignment.count({
      where: { projectId, unassignedAt: null },
    });

    if (activeCount === 0) {
      // status: -> UNASSIGNED (with statusChangedAt)
      await setProjectStatus(tx, projectId, "UNASSIGNED");

      // stop timer
      await tx.project.update({
        where: { id: projectId },
        data: {
          timerRunning: false,
          timerLastResumedAt: null,
        },
      });
    }

    // ✅ Auto workType from assignments (before firstCompletedAt)
    await syncFinanceWorkTypeFromAssignments(tx, projectId);

    await writeSystemMessage(
      tx,
      projectId,
      `Unassigned & cancelled-for-worker: ${userRec.fullName}`,
      actorId
    );
  });

  await notifyAssignees({
    type: "ASSIGNMENT_REMOVED",
    projectId,
    actorId: actorId ?? null,
    title: "You were unassigned from a project",
    body: `Unassigned by admin/manager.`,
  });

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
}

export async function updateAssignmentPaymentAmount(input: z.infer<typeof UpdateSplitSchema>) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const { actorId } = await getActor();

  const parsed = UpdateSplitSchema.safeParse(input);
  if (!parsed.success) redirect("/app/projects?err=invalid_input");

  const { projectId, userId, amount } = parsed.data;

  const money = parseMoney(amount);
  if (!money) backWithError(projectId, "invalid_payment_amount");

  const userRec = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, role: true, archivedAt: true },
  });
  if (!userRec) backWithError(projectId, "user_not_found");
  if (userRec.archivedAt) backWithError(projectId, "user_archived");
  if (userRec.role !== "REMOTE_WORKER") backWithError(projectId, "onsite_payment_not_allowed");

  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, firstCompletedAt: true },
    });
    if (!project) backWithError(projectId, "project_not_found");

   const payableOn = project.firstCompletedAt
      ? payableOnFrom(project.firstCompletedAt)
      : payableOnPlaceholder();

    const line = await tx.projectPaymentLine.findFirst({
      where: { projectId, userId },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    });

    if (!line) {
      await tx.projectPaymentLine.create({
        data: {
          projectId,
          userId,
          amount: money,
          payableOn,
          status: "UNPAID",
        },
      });
    } else {
      if (line.status === "PAID" || line.status === "EXCEPTION_PAID") {
        backWithError(projectId, "cannot_edit_paid_line");
      }

      await tx.projectPaymentLine.update({
        where: { id: line.id },
        data: {
          amount: money,
          payableOn,
          status: "UNPAID",
        },
      });
    }

    // keep legacy project.remotePrice synced
    await syncLegacyRemotePriceFromLines(tx, projectId);

    await writeSystemMessage(
      tx,
      projectId,
      `Payment split updated: ${userRec.fullName} • ${money.toString()}`,
      actorId
    );
  });

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
}