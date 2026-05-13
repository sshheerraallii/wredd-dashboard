"use server";

import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { requireRole } from "@/lib/guards";
import { revalidatePath } from "next/cache";

const prisma = getPrisma();

function back(projectId: string, msg: string) {
  redirect(`/app/projects/${projectId}?err=${encodeURIComponent(msg)}`);
}

export async function watchProject(args: { projectId: string }) {
  await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const projectId = args.projectId;
  const userId = session.user.id;

  // Ensure project exists
  const exists = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!exists) back(projectId, "Project not found.");

  await prisma.projectWatcher.upsert({
    where: {
      projectId_userId: { projectId, userId },
    },
    update: {},
    create: { projectId, userId },
  });

  revalidatePath(`/app/projects/${projectId}`);
}

export async function unwatchProject(args: { projectId: string }) {
  await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

  const session = await readSession();
  if (!session?.user) redirect("/login");

  const projectId = args.projectId;
  const userId = session.user.id;

  await prisma.projectWatcher.deleteMany({
    where: { projectId, userId },
  });

  revalidatePath(`/app/projects/${projectId}`);
}
