"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { requireRole } from "@/lib/guards";
import { notify } from "@/lib/notify";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const prisma = getPrisma();

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function getActor() {
  const session = await readSession();
  const user = session?.user as any;
  if (!user?.id) redirect("/login");
  return {
    actorId: user.id as string,
    actorRole: user.role as string,
  };
}

function requireAdminOrManager(role: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app/ops-tasks?err=forbidden");
  }
}

function requireSuperAdmin(role: string) {
  if (role !== "SUPER_ADMIN") {
    redirect("/app/ops-tasks?err=forbidden");
  }
}

// ─── Points logic ─────────────────────────────────────────────────────────────

/**
 * Points awarded based on how late the task was completed.
 * Uses originalDueAt (never changes even after admin extends deadline)
 * so the true lateness is always measured correctly.
 *
 *   On time  (completedAt <= originalDueAt)          → 10 pts
 *   Late, within 2x the original timer window        →  6 pts
 *   Late, beyond 2x the original timer window        →  3 pts
 */
function calcPoints(
  completedAt: Date,
  originalDueAt: Date,
  timerHours: number
): number {
  if (completedAt <= originalDueAt) return 10;
  const lateMs = completedAt.getTime() - originalDueAt.getTime();
  const timerMs = timerHours * 60 * 60 * 1000;
  if (lateMs <= timerMs) return 6;
  return 3;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  assigneeId: z.string().min(1),
  timerHours: z.coerce.number().int().min(1).max(8760),
  type: z.enum(["ONE_OFF", "RECURRING"]),
  // Array of day numbers: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  // Only used when type === "RECURRING". Defaults to all 7 days if empty.
  runOnDays: z.array(z.number().int().min(0).max(6)).optional(),
});

const CompleteInstanceSchema = z.object({
  instanceId: z.string().min(1),
  note: z.string().max(1000).optional(),
});

const ReopenInstanceSchema = z.object({
  instanceId: z.string().min(1),
});

const ExtendDeadlineSchema = z.object({
  instanceId: z.string().min(1),
  addHours: z.coerce.number().int().min(1).max(8760),
});

const ToggleTaskActiveSchema = z.object({
  taskId: z.string().min(1),
  isActive: z.boolean(),
});

// ─── Create Task ──────────────────────────────────────────────────────────────

export async function createOpsTask(input: z.infer<typeof CreateTaskSchema>) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);
  const { actorId, actorRole } = await getActor();
  requireAdminOrManager(actorRole);

  const parsed = CreateTaskSchema.safeParse(input);
  if (!parsed.success) redirect("/app/admin/ops-tasks?err=invalid_input");

  const { title, description, assigneeId, timerHours, type, runOnDays } =
    parsed.data;

  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, fullName: true, archivedAt: true },
  });
  if (!assignee || assignee.archivedAt) {
    redirect("/app/admin/ops-tasks?err=invalid_assignee");
  }

  const now = new Date();
  const dueAt = new Date(now.getTime() + timerHours * 60 * 60 * 1000);

  const days =
    type === "RECURRING"
      ? runOnDays && runOnDays.length > 0
        ? runOnDays
        : [0, 1, 2, 3, 4, 5, 6]
      : [];

  await prisma.$transaction(async (tx) => {
    const task = await tx.opsTask.create({
      data: {
        title,
        description: description ?? null,
        type,
        assigneeId,
        createdById: actorId,
        timerHours,
        runOnDays: days,
        isActive: true,
      },
    });

    await tx.opsTaskInstance.create({
      data: {
        taskId: task.id,
        assigneeId,
        title,
        timerHours,
        dueAt,
        originalDueAt: dueAt,
        status: "PENDING",
      },
    });
  });

  await notify({
    type: "TASK_ASSIGNED",
    actorId,
    title: `New task assigned: ${title}`,
    body: `Due in ${timerHours} hour${timerHours === 1 ? "" : "s"}.`,
    href: "/app/ops-tasks",
    recipients: { kind: "SPECIFIC_USERS", userIds: [assigneeId] },
  });

  revalidatePath("/app/admin/ops-tasks");
  revalidatePath("/app/ops-tasks");
}

// ─── Complete Instance ─────────────────────────────────────────────────────────

export async function completeOpsTaskInstance(
  input: z.infer<typeof CompleteInstanceSchema>
) {
  await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);
  const { actorId, actorRole } = await getActor();

  const parsed = CompleteInstanceSchema.safeParse(input);
  if (!parsed.success) redirect("/app/ops-tasks?err=invalid_input");

  const { instanceId, note } = parsed.data;

  const instance = await prisma.opsTaskInstance.findUnique({
    where: { id: instanceId },
    select: {
      id: true,
      assigneeId: true,
      status: true,
      originalDueAt: true,
      timerHours: true,
    },
  });

  if (!instance) redirect("/app/ops-tasks?err=not_found");
  if (instance.status === "COMPLETED") redirect("/app/ops-tasks?err=already_done");

  if (actorRole !== "SUPER_ADMIN" && actorRole !== "MANAGER") {
    if (instance.assigneeId !== actorId) {
      redirect("/app/ops-tasks?err=forbidden");
    }
  }

  const now = new Date();
  const points = calcPoints(now, instance.originalDueAt, instance.timerHours);

  await prisma.opsTaskInstance.update({
    where: { id: instanceId },
    data: {
      status: "COMPLETED",
      completedAt: now,
      completionNote: note?.trim() ?? null,
      points,
    },
  });

  revalidatePath("/app/admin/ops-tasks");
  revalidatePath("/app/ops-tasks");
}

// ─── Reopen Instance (Super Admin only) ───────────────────────────────────────

export async function reopenOpsTaskInstance(
  input: z.infer<typeof ReopenInstanceSchema>
) {
  await requireRole(["SUPER_ADMIN"]);
  const { actorId, actorRole } = await getActor();
  requireSuperAdmin(actorRole);

  const parsed = ReopenInstanceSchema.safeParse(input);
  if (!parsed.success) redirect("/app/admin/ops-tasks?err=invalid_input");

  const { instanceId } = parsed.data;

  const instance = await prisma.opsTaskInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, assigneeId: true, status: true, title: true },
  });

  if (!instance) redirect("/app/admin/ops-tasks?err=not_found");
  if (instance.status !== "COMPLETED") {
    redirect("/app/admin/ops-tasks?err=not_completed");
  }

  await prisma.opsTaskInstance.update({
    where: { id: instanceId },
    data: {
      status: "PENDING",
      completedAt: null,
      completionNote: null,
      points: null,
      reopenedAt: new Date(),
      reopenedById: actorId,
    },
  });

  await notify({
    type: "TASK_REOPENED",
    actorId,
    title: `Task reopened: ${instance.title}`,
    body: "Admin has reopened this task. Please review and re-complete it.",
    href: "/app/ops-tasks",
    recipients: { kind: "SPECIFIC_USERS", userIds: [instance.assigneeId] },
  });

  revalidatePath("/app/admin/ops-tasks");
  revalidatePath("/app/ops-tasks");
}

// ─── Extend Deadline (Super Admin only) ───────────────────────────────────────

export async function extendOpsTaskDeadline(
  input: z.infer<typeof ExtendDeadlineSchema>
) {
  await requireRole(["SUPER_ADMIN"]);
  const { actorId, actorRole } = await getActor();
  requireSuperAdmin(actorRole);

  const parsed = ExtendDeadlineSchema.safeParse(input);
  if (!parsed.success) redirect("/app/admin/ops-tasks?err=invalid_input");

  const { instanceId, addHours } = parsed.data;

  const instance = await prisma.opsTaskInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, dueAt: true, status: true, assigneeId: true, title: true },
  });

  if (!instance) redirect("/app/admin/ops-tasks?err=not_found");
  if (instance.status === "COMPLETED") {
    redirect("/app/admin/ops-tasks?err=already_completed");
  }

  const newDueAt = new Date(
    instance.dueAt.getTime() + addHours * 60 * 60 * 1000
  );

  await prisma.opsTaskInstance.update({
    where: { id: instanceId },
    data: {
      dueAt: newDueAt,
      deadlineExtendedAt: new Date(),
      deadlineExtendedById: actorId,
    },
  });

  // originalDueAt is intentionally never updated — points are always
  // calculated against the original deadline, not the extended one.

  revalidatePath("/app/admin/ops-tasks");
  revalidatePath("/app/ops-tasks");
}

// ─── Toggle task active (pause / resume recurring generation) ─────────────────

export async function toggleOpsTaskActive(
  input: z.infer<typeof ToggleTaskActiveSchema>
) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);
  const { actorRole } = await getActor();
  requireAdminOrManager(actorRole);

  const parsed = ToggleTaskActiveSchema.safeParse(input);
  if (!parsed.success) redirect("/app/admin/ops-tasks?err=invalid_input");

  await prisma.opsTask.update({
    where: { id: parsed.data.taskId },
    data: { isActive: parsed.data.isActive },
  });

  revalidatePath("/app/admin/ops-tasks");
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get task instances with full relations.
 * SUPER_ADMIN / MANAGER  → can filter by any assigneeId, or get all
 * BUSINESS_DEVELOPER     → always scoped to their own userId only
 */
export async function getOpsTaskInstances(filters?: {
  assigneeId?: string;
  status?: "PENDING" | "COMPLETED";
  from?: Date;
  to?: Date;
}) {
  await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);
  const { actorId, actorRole } = await getActor();

  const isAdmin = actorRole === "SUPER_ADMIN" || actorRole === "MANAGER";
  const scopedAssigneeId = isAdmin
    ? filters?.assigneeId ?? undefined
    : actorId;

  return prisma.opsTaskInstance.findMany({
    where: {
      ...(scopedAssigneeId ? { assigneeId: scopedAssigneeId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.from || filters?.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    include: {
      assignee: {
        select: { id: true, fullName: true, role: true },
      },
      task: {
        select: { id: true, type: true, description: true },
      },
      deadlineExtendedBy: {
        select: { id: true, fullName: true },
      },
      reopenedBy: {
        select: { id: true, fullName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all OpsTask definitions — admin management view.
 */
export async function getOpsTasks() {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  return prisma.opsTask.findMany({
    include: {
      assignee: { select: { id: true, fullName: true, role: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Commitment score per user for a given date range.
 * Returns array sorted best score first.
 * Admin / Manager only.
 */
export async function getOpsPerformance(from: Date, to: Date) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const instances = await prisma.opsTaskInstance.findMany({
    where: { createdAt: { gte: from, lte: to } },
    include: {
      assignee: { select: { id: true, fullName: true, role: true } },
    },
  });

  const map = new Map<
    string,
    {
      user: { id: string; fullName: string; role: string };
      instances: typeof instances;
    }
  >();

  for (const inst of instances) {
    const key = inst.assigneeId;
    if (!map.has(key)) {
      map.set(key, { user: inst.assignee, instances: [] });
    }
    map.get(key)!.instances.push(inst);
  }

  const results = Array.from(map.values()).map(({ user, instances }) => {
    const totalPossible = instances.length * 10;
    const totalEarned = instances.reduce((sum, i) => sum + (i.points ?? 0), 0);
    const commitmentPct =
      totalPossible > 0
        ? Math.round((totalEarned / totalPossible) * 100)
        : 100;
    const doneCount = instances.filter((i) => i.status === "COMPLETED").length;
    const lateCount = instances.filter(
      (i) =>
        i.status === "COMPLETED" &&
        i.completedAt != null &&
        i.completedAt > i.originalDueAt
    ).length;
    const pendingCount = instances.filter((i) => i.status === "PENDING").length;

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
  });

  return results.sort((a, b) => b.commitmentPct - a.commitmentPct);
}

/**
 * My own performance summary — employee self-view.
 */
export async function getMyOpsPerformance(from: Date, to: Date) {
  await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);
  const { actorId } = await getActor();

  const instances = await prisma.opsTaskInstance.findMany({
    where: {
      assigneeId: actorId,
      createdAt: { gte: from, lte: to },
    },
  });

  const totalPossible = instances.length * 10;
  const totalEarned = instances.reduce((sum, i) => sum + (i.points ?? 0), 0);
  const commitmentPct =
    totalPossible > 0
      ? Math.round((totalEarned / totalPossible) * 100)
      : 100;
  const doneCount = instances.filter((i) => i.status === "COMPLETED").length;
  const lateCount = instances.filter(
    (i) =>
      i.status === "COMPLETED" &&
      i.completedAt != null &&
      i.completedAt > i.originalDueAt
  ).length;
  const pendingCount = instances.filter((i) => i.status === "PENDING").length;

  return {
    totalPossible,
    totalEarned,
    commitmentPct,
    taskCount: instances.length,
    doneCount,
    lateCount,
    pendingCount,
  };
}