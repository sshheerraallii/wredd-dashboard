"use server";

import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const prisma = getPrisma();

/**
 * Upserts a ProjectLastSeen record for the current user + project.
 * Called from the "Mark as read" button on project index cards.
 */
export async function markProjectSeenAction(formData: FormData) {
  const session = await readSession();
  if (!session?.user) return;

  const userId = session.user.id;
  const projectId = String(formData.get("projectId") || "");
  if (!projectId) return;

  try {
    await prisma.projectLastSeen.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId, seenAt: new Date() },
      update: { seenAt: new Date() },
    });
  } catch {
    // non-critical — don't break if this fails
  }

  revalidatePath("/app/projects");
  revalidatePath("/app/worker");
}

/**
 * Direct variant for server components (project detail page auto-mark).
 */
export async function markSeenForUser(userId: string, projectId: string) {
  try {
    await getPrisma().projectLastSeen.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId, seenAt: new Date() },
      update: { seenAt: new Date() },
    });
  } catch {
    // non-critical
  }
}
