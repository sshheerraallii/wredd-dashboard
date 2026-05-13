"use server";

import crypto from "crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendEmail } from "@/lib/email";
import { inviteEmailTemplate } from "@/lib/email-templates";
import { readSession } from "@/lib/auth";

const prisma = getPrisma();

const CreateInviteSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  // SUPER_ADMIN intentionally excluded
  role: z.enum(["MANAGER", "BUSINESS_DEVELOPER", "REMOTE_WORKER", "ONSITE_EMPLOYEE"]),
  workerType: z
    .enum([
      "ONSITE_VIDEO_EDITOR",
      "REMOTE_VIDEO_EDITOR",
      "ONSITE_ANIMATOR",
      "REMOTE_ANIMATOR",
      "WEB_DEVELOPMENT",
      "OPERATIONS",
    ])
    .optional(),
  departmentIds: z.array(z.string()).min(1, "Select at least 1 department"),
});

function backWithError(msg: string) {
  redirect(`/app/admin/invites?err=${encodeURIComponent(msg)}`);
}
function backOk(msg: string) {
  redirect(`/app/admin/invites?ok=${encodeURIComponent(msg)}`);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function createInvite(formData: FormData) {
  await requireAdmin();

  const session = await readSession();
  if (!session?.user?.id) backWithError("No session.");

  const departmentIds = formData.getAll("departmentIds").map(String);

  const parsed = CreateInviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    workerType: (formData.get("workerType") as string) || undefined,
    departmentIds,
  });

  if (!parsed.success) backWithError(parsed.error.issues[0]?.message ?? "Invalid input");

  // Defense-in-depth (even though schema excludes it)
  if ((parsed.data as any).role === "SUPER_ADMIN") {
    backWithError("SUPER_ADMIN cannot be invited from the app.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existingUser) backWithError("A user with this email already exists.");

  await prisma.userInvite.updateMany({
    where: { email: parsed.data.email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const rawToken = makeToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await prisma.$transaction(async (tx) => {
    const inv = await tx.userInvite.create({
      data: {
        email: parsed.data.email,
        role: parsed.data.role,
        workerType: parsed.data.workerType ?? null,
        tokenHash,
        expiresAt,
        createdById: session.user.id,
      },
      select: { id: true, email: true, role: true },
    });

    await tx.userInviteDepartment.createMany({
      data: parsed.data.departmentIds.map((departmentId) => ({
        inviteId: inv.id,
        departmentId,
      })),
    });

    return inv;
  });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const inviteLink = `${appUrl}/register?token=${rawToken}`;

  await sendEmail({
    to: invite.email,
    subject: "Welcome to WREDD — complete your registration",
    html: inviteEmailTemplate({ appUrl, inviteLink, role: invite.role }),
  });

  revalidatePath("/app/admin/invites");
  backOk("Invite sent.");
}

export async function resendInvite(formData: FormData) {
  await requireAdmin();

  const session = await readSession();
  if (!session?.user?.id) backWithError("No session.");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) backWithError("Missing invite ID.");

  const invite = await prisma.userInvite.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!invite) backWithError("Invite not found.");
  if (invite.status !== "PENDING") backWithError("Only pending invites can be resent.");

  // Rotate token and extend expiry
  const rawToken = makeToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.userInvite.update({
    where: { id },
    data: { tokenHash, expiresAt },
  });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const inviteLink = `${appUrl}/register?token=${rawToken}`;

  await sendEmail({
    to: invite.email,
    subject: "Welcome to WREDD — complete your registration",
    html: inviteEmailTemplate({ appUrl, inviteLink, role: invite.role }),
  });

  revalidatePath("/app/admin/invites");
  backOk("Invite resent.");
}

export async function revokeInvite(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) backWithError("Missing invite ID.");

  const invite = await prisma.userInvite.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!invite) backWithError("Invite not found.");
  if (invite.status !== "PENDING") backWithError("Only pending invites can be revoked.");

  await prisma.userInvite.update({
    where: { id },
    data: { status: "REVOKED" },
  });

  revalidatePath("/app/admin/invites");
  backOk("Invite revoked.");
}
