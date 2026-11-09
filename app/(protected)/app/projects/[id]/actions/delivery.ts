"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { notify } from "@/lib/notify";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function isWorker(role: Role | undefined) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

function backWithError(projectId: string, msg: string): never {
  redirect(`/app/projects/${projectId}?err=${encodeURIComponent(msg)}`);
}

const DeliverySchema = z.object({
  projectId: z.string().min(1),
  driveUrl: z
    .string()
    .trim()
    .min(10, "Google Drive link is required")
    .refine((v) => {
      try {
        const u = new URL(v);
        const host = u.hostname.toLowerCase();
        if (host !== "drive.google.com" && host !== "docs.google.com") return false;
        return u.protocol === "https:";
      } catch {
        return false;
      }
    }, "Must be a valid Google Drive/Docs https link"),
  note: z.string().trim().min(3, "Delivery notes are required").max(5000, "Too long"),
  effortHours: z
    .union([z.literal(""), z.coerce.number().positive("Effort hours must be above 0").max(500, "Effort hours look too high")])
    .optional(),
});

// Statuses an operator (Super Admin / flagged user) may deliver from.
const OPERATOR_DELIVERABLE = ["UNASSIGNED", "IN_PROGRESS", "REVISION"] as const;

function secondsBetween(later: Date, earlier: Date) {
  const ms = later.getTime() - earlier.getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

export async function deliverProject(formData: FormData) {
  const parsed = DeliverySchema.safeParse({
    projectId: formData.get("projectId"),
    driveUrl: formData.get("driveUrl"),
    note: formData.get("note"),
    effortHours: (formData.get("effortHours") as string | null) ?? "",
  });

  if (!parsed.success) {
    const projectId = String(formData.get("projectId") || "");
    backWithError(projectId, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { projectId, driveUrl, note } = parsed.data;
  const effortHours =
    typeof parsed.data.effortHours === "number" ? parsed.data.effortHours : null;

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const userId = session.user.id;

  // Operators deliver without an assignment: Super Admin always, others by flag.
  let isOperator = role === "SUPER_ADMIN";
  if (!isOperator && !isWorker(role)) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { canDeliverUnassigned: true, archivedAt: true },
    });
    isOperator = !!me?.canDeliverUnassigned && !me.archivedAt;
  }

  if (!isWorker(role) && !isOperator) {
    backWithError(projectId, "You do not have permission to deliver projects.");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true, // ✅ needed for notification
      status: true,
      timerRunning: true,
      timerLastResumedAt: true,
      timerAccumulatedSeconds: true,
      firstCompletedAt: true,
      effortHours: true,
      assignments: {
        where: { unassignedAt: null },
        select: { id: true, userId: true },
      },
    },
  });

  if (!project) backWithError(projectId, "Project not found.");

  const isAssigned = project.assignments.some((a) => a.userId === userId);
  if (isWorker(role)) {
    if (!isAssigned) backWithError(projectId, "You are not assigned to this project.");
  } else if (!(OPERATOR_DELIVERABLE as readonly string[]).includes(project.status)) {
    backWithError(projectId, `Cannot deliver a project that is ${project.status}.`);
  }

  // No worker on it and never completed => produced in-house.
  const markStudio =
    !isWorker(role) && project.assignments.length === 0 && !project.firstCompletedAt;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 1) Log DELIVERY message
    await tx.projectMessage.create({
      data: {
        projectId,
        type: "DELIVERY",
        createdById: userId,
        linkUrl: driveUrl,
        content: note,
      },
    });

    // 2) Pause timer if running
    let timerAccumulatedSeconds = project.timerAccumulatedSeconds ?? 0;
    let timerRunning = project.timerRunning ?? false;
    let timerLastResumedAt = project.timerLastResumedAt;

    if (timerRunning && timerLastResumedAt) {
      timerAccumulatedSeconds += secondsBetween(now, timerLastResumedAt);
      timerRunning = false;
      timerLastResumedAt = null;
    }

    // 3) Update status to DELIVERED (effort hours add up across deliveries)
    await tx.project.update({
      where: { id: projectId },
      data: {
        status: "DELIVERED",
        statusChangedAt: now,
        timerRunning,
        timerLastResumedAt,
        timerAccumulatedSeconds,
        ...(effortHours != null
          ? { effortHours: (project.effortHours ?? 0) + effortHours }
          : {}),
      },
    });

    // 3b) In-house delivery: no worker payout, no floor hours
    if (markStudio) {
      await tx.projectFinance.updateMany({
        where: { projectId },
        data: { workType: "STUDIO", allowedHours: null },
      });
    }

    // 4) Activity log
    await tx.projectActivity.create({
      data: {
        projectId,
        actorId: userId,
        action: "DELIVERED",
        data: {
          driveUrl,
          noteLength: note.length,
          effortHours,
          deliveredAs: isWorker(role) ? "WORKER" : "OPERATOR",
          studio: markStudio,
        },
      },
    });
  });

  // ✅ Notify watchers + other assignees (actor excluded automatically)
  await notify({
    type: "PROJECT_STATUS_CHANGED",
    projectId,
    actorId: userId,
    title: `Project Delivered: ${project.title}`,
    body: `The project has been marked as delivered. Review the Google Drive link and delivery notes in the project chat.`,
    href: `/app/projects/${projectId}`,
    recipients: { kind: "PROJECT_AUDIENCE" },
  });

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?ok=${encodeURIComponent("Delivered with Drive link + notes")}`);
}
