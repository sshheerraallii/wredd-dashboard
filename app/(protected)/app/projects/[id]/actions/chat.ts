"use server";

import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/guards";
import { notify } from "@/lib/notify";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function isWorker(role: Role | undefined) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

function isAdminLike(role: Role | undefined) {
  return (
    role === "SUPER_ADMIN" ||
    role === "MANAGER" ||
    role === "BUSINESS_DEVELOPER" ||
    role === "BD"
  );
}

function normalizeContent(input: string) {
  return (input || "").replace(/\r\n/g, "\n").trim();
}

export async function sendChatMessage(args: { projectId: string; content: string }) {
  await requireRole([
    "SUPER_ADMIN",
    "MANAGER",
    "BUSINESS_DEVELOPER",
    "BD",
    "REMOTE_WORKER",
    "ONSITE_EMPLOYEE",
  ]);

  const session = await readSession();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };

  const role = session.user.role as Role | undefined;
  const actorId = session.user.id;

  const projectId = args.projectId;
  const content = normalizeContent(args.content);

  if (!projectId) return { ok: false as const, error: "Missing projectId" };
  if (!content) return { ok: false as const, error: "Message is empty" };
  if (content.length > 8000)
    return { ok: false as const, error: "Message too long (max 8000 chars)" };

  // Load assignment context for posting rule
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      assignments: {
        where: { unassignedAt: null },
        select: { userId: true },
      },
    },
  });

  if (!project) return { ok: false as const, error: "Project not found" };

  const assignedUserIds = new Set(project.assignments.map((a) => a.userId));
  const isAssigned = assignedUserIds.has(actorId);

  // Posting rules:
  // - Admin-like can post
  // - Worker can post only if assigned
  if (isWorker(role) && !isAssigned) {
    return { ok: false as const, error: "Read-only: you can chat only when assigned." };
  }
  if (!isAdminLike(role) && !isAssigned) {
    return { ok: false as const, error: "Forbidden" };
  }

  // ✅ Schema-correct: ProjectMessage.createdById (NOT userId)
  await prisma.projectMessage.create({
    data: {
      projectId,
      createdById: actorId,
      type: "TEXT",
      content,
    },
  });

  revalidatePath(`/app/projects/${projectId}`);

  await notify({
    type: "PROJECT_MESSAGE",
    projectId,
    actorId,
    title: "New project message",
    body: content.length > 180 ? content.slice(0, 180) + "…" : content,
    href: `/app/projects/${projectId}?focus=chat`,
    // ✅ watchers + assignees (in-app); email remains assignees-only by lib gating
    recipients: { kind: "PROJECT_AUDIENCE" },
  });

  return { ok: true as const };
}
