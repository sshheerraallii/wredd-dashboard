// /lib/notify.ts
import { getPrisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { NotificationType } from "@prisma/client";

const prisma = getPrisma();

type NotifyArgs = {
  type: NotificationType;
  projectId?: string;
  actorId?: string | null;

  title: string;
  body?: string | null;
  href?: string | null;

  recipients:
    | { kind: "PROJECT_ASSIGNEES_ACTIVE" }
    | { kind: "PROJECT_AUDIENCE" } // assignees + watchers (in-app)
    | { kind: "DEPARTMENT_USERS"; departmentId: string; workersOnly?: boolean }
    | { kind: "SPECIFIC_USERS"; userIds: string[] }; // ops tasks + direct targeting
};

function uniq(ids: string[]) {
  return Array.from(new Set(ids));
}

function exclude(ids: string[], actorId?: string | null) {
  if (!actorId) return ids;
  return ids.filter((id) => id !== actorId);
}

async function getProjectAssigneeUserIds(projectId: string) {
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId, unassignedAt: null },
    select: { userId: true, user: { select: { archivedAt: true } } },
  });

  return rows.filter((r) => !r.user.archivedAt).map((r) => r.userId);
}

async function getProjectWatcherUserIds(projectId: string) {
  const rows = await prisma.projectWatcher.findMany({
    where: { projectId },
    select: { userId: true, user: { select: { archivedAt: true } } },
  });

  return rows.filter((r) => !r.user.archivedAt).map((r) => r.userId);
}

async function getDepartmentUserIds(departmentId: string, workersOnly?: boolean) {
  const rows = await prisma.userDepartment.findMany({
    where: { departmentId },
    select: {
      userId: true,
      user: { select: { archivedAt: true, role: true } },
    },
  });

  return rows
    .filter((r) => !r.user.archivedAt)
    .filter((r) =>
      workersOnly
        ? r.user.role === "REMOTE_WORKER" || r.user.role === "ONSITE_EMPLOYEE"
        : true
    )
    .map((r) => r.userId);
}

/**
 * Maps a notification type to the preference column that gates its email.
 * Returns null = no email for this type (in-app only).
 */
function emailGateForType(type: NotificationType): string | null {
  // In-app only
  if (type === "PROJECT_CREATED_UNASSIGNED") return null;

  // Project events
  if (type === "PROJECT_MESSAGE") return "emailProjectMessages";
  if (type === "PROJECT_STATUS_CHANGED") return "emailProjectStatus";
  if (type === "PROJECT_COMPLETED" || type === "PROJECT_CANCELLED")
    return "emailProjectCompletion";
  if (type === "PROJECT_RATED") return "emailProjectRatings";
  if (type === "ASSIGNMENT_ADDED" || type === "ASSIGNMENT_REMOVED")
    return "emailAssignments";

  // Ops task events
  if (type === "TASK_ASSIGNED" || type === "TASK_REOPENED")
    return "emailTaskAssigned";
  if (type === "TASK_DUE_SOON") return "emailTaskDueSoon";

  return null;
}

async function getEmailEligibleRecipients(
  userIds: string[],
  type: NotificationType
) {
  const gate = emailGateForType(type);
  if (!gate) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, archivedAt: null },
    select: {
      id: true,
      email: true,
      notificationPreferences: {
        select: {
          emailProjectMessages: true,
          emailProjectStatus: true,
          emailProjectCompletion: true,
          emailProjectRatings: true,
          emailAssignments: true,
          emailTaskAssigned: true,
          emailTaskDueSoon: true,
        },
      },
    },
  });

  // Default: if preference row is missing, treat all flags as true
  return users.filter((u) => {
    const pref = u.notificationPreferences;
    if (!pref) return true;
    return (pref as any)[gate] === true;
  });
}

function buildEmailHtml(args: {
  title: string;
  body?: string | null;
  href?: string | null;
}) {
  const safeBody = args.body
    ? args.body.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  const fullHref = args.href
    ? args.href.startsWith("/")
      ? `${appUrl}${args.href}`
      : args.href
    : null;
  const link = fullHref
    ? `<p><a href="${fullHref}">Open in WREDD</a></p>`
    : "";
  return `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;">
      <h2 style="margin:0 0 8px 0;">${args.title}</h2>
      ${safeBody ? `<p style="margin:0 0 12px 0; white-space:pre-wrap;">${safeBody}</p>` : ""}
      ${link}
      <hr style="margin:16px 0; opacity:.2;" />
      <p style="margin:0; font-size:12px; opacity:.7;">WREDD Dashboard</p>
    </div>
  `;
}

export async function notify(args: NotifyArgs) {
  // ── 1. Resolve recipient IDs ───────────────────────────────────────────────

  let recipientIds: string[] = [];

  if (args.recipients.kind === "PROJECT_ASSIGNEES_ACTIVE") {
    if (!args.projectId) return;
    recipientIds = await getProjectAssigneeUserIds(args.projectId);
    recipientIds = exclude(recipientIds, args.actorId);
  }

  if (args.recipients.kind === "PROJECT_AUDIENCE") {
    if (!args.projectId) return;
    const [assignees, watchers] = await Promise.all([
      getProjectAssigneeUserIds(args.projectId),
      getProjectWatcherUserIds(args.projectId),
    ]);
    recipientIds = exclude(uniq([...assignees, ...watchers]), args.actorId);
  }

  if (args.recipients.kind === "DEPARTMENT_USERS") {
    recipientIds = await getDepartmentUserIds(
      args.recipients.departmentId,
      args.recipients.workersOnly
    );
    recipientIds = exclude(recipientIds, args.actorId);
  }

  if (args.recipients.kind === "SPECIFIC_USERS") {
    // Filter out empty strings, then exclude actor
    recipientIds = exclude(
      args.recipients.userIds.filter(Boolean),
      args.actorId
    );
  }

  recipientIds = uniq(recipientIds);
  if (!recipientIds.length) return;

  // ── 2. Create in-app notifications ────────────────────────────────────────

  const created = await prisma.$transaction(async (tx) => {
    const rows = await Promise.all(
      recipientIds.map((userId) =>
        tx.notification.create({
          data: {
            userId,
            type: args.type,
            title: args.title,
            body: args.body ?? null,
            href: args.href ?? null,
            projectId: args.projectId ?? null,
            actorId: args.actorId ?? null,
          },
          select: { id: true, userId: true },
        })
      )
    );
    return rows;
  });

  // ── 3. Queue email deliveries ─────────────────────────────────────────────

  const gate = emailGateForType(args.type);
  if (!gate) return;

  // Only send emails for project-assignee events or direct targeting
  const kind = args.recipients.kind;
  if (kind !== "PROJECT_ASSIGNEES_ACTIVE" && kind !== "SPECIFIC_USERS") return;

  const eligible = await getEmailEligibleRecipients(
    created.map((c) => c.userId),
    args.type
  );

  if (!eligible.length) return;

  const subject = args.title;
  const html = buildEmailHtml({
    title: args.title,
    body: args.body,
    href: args.href,
  });

  await prisma.notificationDelivery.createMany({
    data: eligible.map((u) => ({
      notificationId: created.find((c) => c.userId === u.id)?.id ?? null,
      userId: u.id,
      toEmail: u.email,
      subject,
      html,
      status: "PENDING",
    })),
  });
}

/**
 * Called from the cron route to flush pending email deliveries.
 */
export async function sendPendingEmailDeliveries(limit = 25) {
  const pending = await prisma.notificationDelivery.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const d of pending) {
    try {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          attempts: d.attempts + 1,
          lastAttemptAt: new Date(),
        },
      });

      await sendEmail({ to: d.toEmail, subject: d.subject, html: d.html });

      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "SENT", sentAt: new Date(), error: null },
      });
    } catch (e: any) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: "FAILED",
          error: String(e?.message ?? e),
          lastAttemptAt: new Date(),
        },
      });
    }
  }

  return { processed: pending.length };
}