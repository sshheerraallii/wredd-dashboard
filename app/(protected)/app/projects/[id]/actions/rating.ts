"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { requireRole } from "@/lib/guards";
import { notify } from "@/lib/notify";

const prisma = getPrisma();

function back(projectId: string, msg: string) {
  redirect(`/app/projects/${projectId}?err=${encodeURIComponent(msg)}`);
}

const RatingSchema = z.object({
  projectId: z.string().min(1),
  communication: z.coerce.number().int().min(1).max(5),
  quality: z.coerce.number().int().min(1).max(5),
  speed: z.coerce.number().int().min(1).max(5),
  professionalism: z
    .union([z.coerce.number().int().min(1).max(5), z.nan()])
    .optional(),
});

export async function createProjectRating(formData: FormData) {
 await requireRole(["BUSINESS_DEVELOPER", "SUPER_ADMIN"]);

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const canRate =
    session.user.role === "BUSINESS_DEVELOPER" ||
    session.user.role === "SUPER_ADMIN";

  if (!canRate) {
    back(String(formData.get("projectId") ?? ""), "Only BD or Super Admin can submit ratings.");
  }

  const parsed = RatingSchema.safeParse({
    projectId: formData.get("projectId"),
    communication: formData.get("communication"),
    quality: formData.get("quality"),
    speed: formData.get("speed"),
    professionalism:
      formData.get("professionalism") === "" || formData.get("professionalism") == null
        ? undefined
        : formData.get("professionalism"),
  });

  if (!parsed.success) {
    back(
      String(formData.get("projectId") ?? ""),
      parsed.error.issues[0]?.message ?? "Invalid rating"
    );
  }

  const { projectId, communication, quality, speed, professionalism } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      firstCompletedAt: true,
      rating: { select: { id: true } },
    },
  });

  if (!project) back(projectId, "Project not found.");
  if (project.status !== "COMPLETED") back(projectId, "Project must be COMPLETED to rate.");
  if (!project.firstCompletedAt) back(projectId, "First completion timestamp missing.");
  if (project.rating) back(projectId, "Rating already exists and cannot be changed.");

  await prisma.projectRating.create({
    data: {
      projectId,
      communication,
      quality,
      speed,
      professionalism: professionalism ?? null,
      ratedById: session.user.id,
    },
  });

  await notify({
    type: "PROJECT_RATED",
    projectId,
    actorId: session.user.id,
    title: "Project rated",
    body: `A rating was submitted for this project.`,
    href: `/app/projects/${projectId}?focus=rating`,
    recipients: { kind: "PROJECT_ASSIGNEES_ACTIVE" },
  });

  redirect(`/app/projects/${projectId}?ok=${encodeURIComponent("Rating submitted")}`);
}
