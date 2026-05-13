"use server";

import crypto from "crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

const prisma = getPrisma();

const ResetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

function backWithError(token: string, msg: string) {
  redirect(`/reset-password?token=${encodeURIComponent(token)}&err=${encodeURIComponent(msg)}`);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function resetPassword(formData: FormData) {
  const token = String(formData.get("token") || "");
  const parsed = ResetSchema.safeParse({
    token,
    password: formData.get("password"),
  });

  if (!parsed.success) backWithError(token, parsed.error.issues[0]?.message ?? "Invalid input");

  const tokenHash = hashToken(parsed.data.token);

  const prt = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { id: true, archivedAt: true } },
    },
  });

  if (!prt) backWithError(token, "Invalid or expired reset link.");
  if (prt.usedAt) backWithError(token, "This reset link was already used.");
  if (prt.user.archivedAt) backWithError(token, "Account is archived.");
  if (prt.expiresAt.getTime() < Date.now()) backWithError(token, "Reset link expired.");

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: prt.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.update({
      where: { id: prt.id },
      data: { usedAt: new Date() },
    });
  });

  redirect(`/login?ok=${encodeURIComponent("Password updated. Please login.")}`);
}
