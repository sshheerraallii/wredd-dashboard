"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/guards";

const prisma = getPrisma();

function back(projectId: string, msg: string) {
  redirect(`/app/projects/${projectId}?err=${encodeURIComponent(msg)}`);
}

const RatingSchema = z.object({
  m1: z.coerce.number().int().min(1).max(5),
  m2: z.coerce.number().int().min(1).max(5),
  m3: z.coerce.number().int().min(1).max(5),
  m4: z.coerce.number().int().min(1).max(5),
  m5: z.coerce.number().int().min(1).max(5),
});

const CreditsSchema = z.array(
  z.object({
    userId: z.string().min(1),
    points: z.coerce.number().int().min(0).max(100000),
  })
);

function toMonthKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function canFinalize(role?: string) {
  return role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";
}

/**
 * Finalize onsite performance for a project:
 * - creates ONE OnsiteProjectRating for the project (optional: you can require it in UI)
 * - creates OnsitePointCredit for each assigned onsite worker (manual split)
 *
 * Immutable: cannot be run twice.
 */
export async function finalizeOnsitePerformance(
  projectId: string,
  formData: FormData
) {
  const user = await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as string | undefined;
  const actorId = session.user.id as string;

  if (!canFinalize(role)) back(projectId, "forbidden");

  // Parse rating fields
  const ratingParsed = RatingSchema.safeParse({
    m1: formData.get("m1"),
    m2: formData.get("m2"),
    m3: formData.get("m3"),
    m4: formData.get("m4"),
    m5: formData.get("m5"),
  });

  // Parse credits (JSON string)
  let creditsRaw: unknown = null;
  try {
    creditsRaw = JSON.parse(String(formData.get("credits") || "[]"));
  } catch {
    back(projectId, "Invalid credits payload");
  }

  const creditsParsed = CreditsSchema.safeParse(creditsRaw);
  if (!creditsParsed.success) back(projectId, "Invalid credits");

  // Load project + assignments
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      firstCompletedAt: true,
      onsiteRating: { select: { id: true } },
      onsiteCredits: { select: { id: true, userId: true } },
      assignments: {
        where: { unassignedAt: null },
        select: {
          userId: true,
          user: { select: { id: true, workerType: true } },
        },
      },
    },
  });

  if (!project) back(projectId, "Project not found");

  if (project.status !== "COMPLETED") {
    back(projectId, "Project must be COMPLETED first");
  }

  if (!project.firstCompletedAt) {
    back(projectId, "firstCompletedAt missing (cannot finalize)");
  }

  // Prevent reruns
  if (project.onsiteRating || project.onsiteCredits.length > 0) {
    back(projectId, "Onsite performance already finalized");
  }

  // Eligible onsite workers (assigned and workerType onsite)
  const onsiteAssigned = project.assignments
    .filter((a) => {
      const wt = a.user.workerType;
      return wt === "ONSITE_VIDEO_EDITOR" || wt === "ONSITE_ANIMATOR";
    })
    .map((a) => a.userId);

  if (onsiteAssigned.length === 0) {
    back(projectId, "No onsite assigned workers");
  }

  // Credits must match onsiteAssigned exactly (no missing, no extras)
  const credits = creditsParsed.data;

  const creditsUserIds = credits.map((c) => c.userId);
  const uniq = new Set(creditsUserIds);
  if (uniq.size !== creditsUserIds.length) back(projectId, "Duplicate credit userId");

  const missing = onsiteAssigned.filter((id) => !uniq.has(id));
  const extra = creditsUserIds.filter((id) => !onsiteAssigned.includes(id));

  if (missing.length > 0) back(projectId, "Missing credits for some assigned onsite workers");
  if (extra.length > 0) back(projectId, "Credits include unassigned/non-onsite users");

  const monthKey = toMonthKey(project.firstCompletedAt);

  await prisma.$transaction(async (tx) => {
    // Rating is required by your system design; enforce it
    if (!ratingParsed.success) {
      throw new Error("Invalid rating");
    }

    await tx.onsiteProjectRating.create({
      data: {
        projectId: project.id,
        m1: ratingParsed.data.m1,
        m2: ratingParsed.data.m2,
        m3: ratingParsed.data.m3,
        m4: ratingParsed.data.m4,
        m5: ratingParsed.data.m5,
        ratedById: actorId,
      },
    });

    await tx.onsitePointCredit.createMany({
      data: credits.map((c) => ({
        projectId: project.id,
        userId: c.userId,
        points: c.points,
        setById: actorId,
        monthKey,
      })),
    });

    // Optional: activity log (keeps history consistent)
    await tx.projectActivity.create({
      data: {
        projectId: project.id,
        actorId,
        action: "ONSITE_FINALIZED",
        data: { monthKey },
      },
    });

    // Optional: system message
    await tx.projectMessage.create({
      data: {
        projectId: project.id,
        createdById: actorId,
        type: "SYSTEM",
        content: "Onsite performance finalized (rating + points split).",
        meta: { monthKey },
      },
    });
  });

  revalidatePath(`/app/projects/${projectId}`);
  redirect(`/app/projects/${projectId}?ok=${encodeURIComponent("Onsite finalized")}`);
}
