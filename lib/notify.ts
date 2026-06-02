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
    | { kind: "PROJECT_AUDIENCE" } // assignees + watchers (in-app AND email)
    | { kind: "DEPARTMENT_USERS"; departmentId: string; workersOnly?: boolean }
    | { kind: "SPECIFIC_USERS"; userIds: string[] };
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

function emailGateForType(type: NotificationType): string | null {
  if (type === "PROJECT_CREATED_UNASSIGNED") return null;
  if (type === "PROJECT_MESSAGE") return "emailProjectMessages";
  if (type === "PROJECT_STATUS_CHANGED") return "emailProjectStatus";
  if (type === "PROJECT_COMPLETED" || type === "PROJECT_CANCELLED")
    return "emailProjectCompletion";
  if (type === "PROJECT_RATED") return "emailProjectRatings";
  if (type === "ASSIGNMENT_ADDED" || type === "ASSIGNMENT_REMOVED")
    return "emailAssignments";
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
  projectTitle?: string | null;
  actorName?: string | null;
}) {
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  const fullHref = args.href
    ? args.href.startsWith("/")
      ? `${appUrl}${args.href}`
      : args.href
    : null;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const projectBlock = args.projectTitle
    ? `<div style="margin:0 0 16px;padding:12px 16px;background:#f5f5f5;border-radius:8px;border-left:4px solid #8F4043;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999;margin-bottom:4px;">Project</div>
        <div style="font-size:15px;font-weight:700;color:#1B1B1B;">${esc(args.projectTitle)}</div>
      </div>`
    : "";

  const actorBlock = args.actorName
    ? `<p style="margin:0 0 12px;font-size:13px;color:#555;">By: <strong style="color:#1B1B1B;">${esc(args.actorName)}</strong></p>`
    : "";

  const bodyBlock = args.body
    ? `<p style="margin:0 0 16px;font-size:14px;color:#333;white-space:pre-wrap;">${esc(args.body)}</p>`
    : "";

  const ctaBlock = fullHref
    ? `<p style="margin:0;">
        <a href="${fullHref}" style="display:inline-block;padding:10px 22px;border-radius:8px;text-decoration:none;background:#8F4043;color:#fff;font-weight:700;font-size:14px;">
          Open Project &rarr;
        </a>
      </p>`
    : "";

  return `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <div style="margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8F4043;font-weight:700;">WREDD Dashboard</div>
      <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#1B1B1B;line-height:1.3;">${esc(args.title)}</h2>
      ${projectBlock}
      ${actorBlock}
      ${bodyBlock}
      ${ctaBlock}
      <hr style="margin:28px 0 16px;border:none;border-top:1px solid #eee;" />
      <p style="margin:0;font-size:11px;color:#aaa;line-height:1.5;">WREDD Internal Dashboard &bull; You received this because you are assigned to or watching this project.</p>
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

  // ✅ Fixed: PROJECT_AUDIENCE now sends emails too.
  // Previously only PROJECT_ASSIGNEES_ACTIVE and SPECIFIC_USERS sent emails,
  // which meant watchers (admins/managers watching a project) never got emails.
  const kind = args.recipients.kind;
  if (
    kind !== "PROJECT_ASSIGNEES_ACTIVE" &&
    kind !== "SPECIFIC_USERS" &&
    kind !== "PROJECT_AUDIENCE"
  ) {
    return;
  }

  const eligible = await getEmailEligibleRecipients(
    created.map((c) => c.userId),
    args.type
  );
  if (!eligible.length) return;

  // ── 4. Fetch rich context for email ──────────────────────────────────────

  let projectTitle: string | null = null;
  if (args.projectId) {
    const proj = await prisma.project.findUnique({
      where: { id: args.projectId },
      select: { title: true },
    });
    projectTitle = proj?.title ?? null;
  }

  let actorName: string | null = null;
  if (args.actorId) {
    const actor = await prisma.user.findUnique({
      where: { id: args.actorId },
      select: { fullName: true },
    });
    actorName = actor?.fullName ?? null;
  }

  const subject = projectTitle
    ? `${args.title} — ${projectTitle}`
    : args.title;

  const html = buildEmailHtml({
    title: args.title,
    body: args.body,
    href: args.href,
    projectTitle,
    actorName,
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
        data: { attempts: d.attempts + 1, lastAttemptAt: new Date() },
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
