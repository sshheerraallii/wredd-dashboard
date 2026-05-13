"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PrismaClient } from "@prisma/client";
import { requireRole } from "@/lib/guards";

const prisma = getPrisma();

function requireCanExtend(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "BUSINESS_DEVELOPER") {
    redirect("/app?err=forbidden");
  }
}

const ExtendSchema = z.object({
  projectId: z.string().min(1),
  addHours: z.coerce.number().int().min(1, "Minimum 1 hour").max(720, "Too large"), // up to 30 days
});

async function writeDeadlineExtended(
  tx: PrismaClient,
  projectId: string,
  content: string,
  actorId?: string
) {
  // Use DEADLINE_EXTENDED message type (you already have it in enum)
  await tx.projectMessage.create({
    data: {
      projectId,
      createdById: actorId ?? null,
      type: "DEADLINE_EXTENDED",
      content,
    },
  });

  await tx.projectActivity.create({
    data: {
      projectId,
      actorId: actorId ?? null,
      action: "DEADLINE_EXTENDED",
      data: { content },
    },
  });
}

export async function extendDeadline(input: z.infer<typeof ExtendSchema>) {
  const user = await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

  const session = await readSession();
  requireCanExtend((session?.user as any)?.role);

  const parsed = ExtendSchema.safeParse(input);
  if (!parsed.success) {
    redirect(`/app/projects/${input?.projectId ?? ""}?err=invalid_input`);
  }

  const { projectId, addHours } = parsed.data;
  const actorId = (session?.user as any)?.id as string | undefined;
  const actorName = (session?.user as any)?.name || (session?.user as any)?.email || "User";

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, deadlineHours: true },
  });
  if (!project) redirect("/app/projects?err=project_not_found");

  const before = project.deadlineHours ?? 0;
  const after = before + addHours;

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: { deadlineHours: after },
    });

    await writeDeadlineExtended(
      tx,
      projectId,
      `Deadline extended: ${before}h → ${after}h (+${addHours}h) by ${actorName}`,
      actorId
    );
  });

  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
}
