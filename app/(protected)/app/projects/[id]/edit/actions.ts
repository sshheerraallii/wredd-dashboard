// app/(protected)/app/projects/[id]/edit/actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

function requireCanManageProject(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "BUSINESS_DEVELOPER") {
    redirect("/app?err=forbidden");
  }
}

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(2).max(140),
  description: z.string().max(5000).optional().nullable(),
  departmentId: z.string().min(1),
  deadlineHours: z.coerce.number().int().min(1).max(24 * 365),
});

export async function updateProject(formData: FormData) {
  const session = await readSession();
  requireCanManageProject(session?.user?.role);

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    departmentId: formData.get("departmentId"),
    deadlineHours: formData.get("deadlineHours"),
  });

  if (!parsed.success) {
    redirect(`/app/projects?err=invalid_input`);
  }

  const { id, title, description, departmentId, deadlineHours } = parsed.data;

  await prisma.project.update({
    where: { id },
    data: {
      title,
      description: description ? description : null,
      departmentId,
      deadlineHours,
    },
    select: { id: true },
  });

  redirect(`/app/projects/${id}?ok=updated`);
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteProject(formData: FormData) {
  const session = await readSession();
  requireCanManageProject(session?.user?.role);

  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) redirect(`/app/projects?err=invalid_input`);

  const { id } = parsed.data;

  // Hard delete (simple + consistent). If you later want soft-delete, we’ll add archivedAt/status.
  await prisma.project.delete({ where: { id } });

  redirect(`/app/projects?ok=deleted`);
}