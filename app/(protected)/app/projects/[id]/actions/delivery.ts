"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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

function backWithError(projectId: string, msg: string) {
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
        // allow drive.google.com and docs.google.com
        if (host !== "drive.google.com" && host !== "docs.google.com") return false;
        return u.protocol === "https:";
      } catch {
        return false;
      }
    }, "Must be a valid Google Drive/Docs https link"),
  note: z.string().trim().min(3, "Delivery notes are required").max(5000, "Too long"),
});

function secondsBetween(later: Date, earlier: Date) {
  const ms = later.getTime() - earlier.getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

export async function deliverProject(formData: FormData) {
  const parsed = DeliverySchema.safeParse({
    projectId: formData.get("projectId"),
    driveUrl: formData.get("driveUrl"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    const projectId = String(formData.get("projectId") || "");
    backWithError(projectId, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { projectId, driveUrl, note } = parsed.data;

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const userId = session.user.id;

  if (!isWorker(role)) backWithError(projectId, "Only workers can deliver projects.");

  // Fetch project + verify caller is currently assigned (unassignedAt = null)
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      timerRunning: true,
      timerLastResumedAt: true,
      timerAccumulatedSeconds: true,
      assignments: {
        where: { unassignedAt: null },
        select: { id: true, userId: true },
      },
    },
  });

  if (!project) backWithError(projectId, "Project not found.");

  const isAssigned = project.assignments.some((a) => a.userId === userId);
  if (!isAssigned) backWithError(projectId, "You are not assigned to this project.");

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 1) Log DELIVERY message (use schema fields properly)
    await tx.projectMessage.create({
      data: {
        projectId,
        type: "DELIVERY",
        createdById: userId,
        linkUrl: driveUrl,
        content: note,
        // meta is optional; keep empty unless you want structured data later
        // meta: { driveUrl },
      },
    });

    // 2) Pause timer if running (DELIVERED should pause)
    let timerAccumulatedSeconds = project.timerAccumulatedSeconds ?? 0;
    let timerRunning = project.timerRunning ?? false;
    let timerLastResumedAt = project.timerLastResumedAt;

    if (timerRunning && timerLastResumedAt) {
      timerAccumulatedSeconds += secondsBetween(now, timerLastResumedAt);
      timerRunning = false;
      timerLastResumedAt = null;
    }

  // 3) Update status to DELIVERED
    await tx.project.update({
      where: { id: projectId },
      data: {
        status: "DELIVERED",
        statusChangedAt: now,
        timerRunning,
        timerLastResumedAt,
        timerAccumulatedSeconds,
      },
    });

    // 4) Optional: activity log (you have ProjectActivity)
    await tx.projectActivity.create({
      data: {
        projectId,
        actorId: userId,
        action: "DELIVERED",
        data: {
          driveUrl,
          noteLength: note.length,
        },
      },
    });
  });

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?ok=${encodeURIComponent("Delivered with Drive link + notes")}`);
}
