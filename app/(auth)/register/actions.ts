"use server";

import crypto from "crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

const prisma = getPrisma();

const RegisterSchema = z.object({
  token: z.string().min(10),
  fullName: z.string().trim().min(2, "Full name is too short").max(80, "Full name is too long"),
  username: z.string().trim().min(3, "Username too short").max(30, "Username too long"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

function backWithError(msg: string) {
  redirect(`/register?err=${encodeURIComponent(msg)}`);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeUsername(u: string) {
  return u.trim().replace(/\s+/g, "");
}

export async function completeRegistration(formData: FormData) {
  const parsed = RegisterSchema.safeParse({
    token: formData.get("token"),
    fullName: formData.get("fullName"),
    username: formData.get("username"),
    password: formData.get("password"),
  });

if (!parsed.success) { backWithError(parsed.error.issues[0]?.message ?? "Invalid input"); return; }

  const tokenHash = hashToken(parsed.data.token);
  const username = normalizeUsername(parsed.data.username);

  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      workerType: true,
      status: true,
      expiresAt: true,
      departments: { select: { departmentId: true } },
    },
  });

  if (!invite) backWithError("Invalid or expired invite link.");
  if (invite.status !== "PENDING") backWithError("This invite link is no longer valid.");
  if (invite.expiresAt.getTime() < Date.now()) {
    // mark expired (best-effort)
    await prisma.userInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    backWithError("This invite has expired. Ask admin for a new invite.");
  }

  const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existingUser) backWithError("An account with this email already exists. Please login.");

  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) backWithError("Username already taken.");

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

await prisma.$transaction(async (tx: any) => {
    const user = await tx.user.create({
      data: {
        email: invite.email,
        fullName: parsed.data.fullName.trim(),
        username,
        passwordHash,
        role: invite.role,
        workerType: invite.workerType,
      },
      select: { id: true },
    });

    if (invite.departments.length > 0) {
      await tx.userDepartment.createMany({
        data: invite.departments.map((d) => ({
          userId: user.id,
          departmentId: d.departmentId,
        })),
      });
    }

    await tx.userInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
  });

  redirect(`/login?ok=${encodeURIComponent("Account created. Please login.")}`);
}
