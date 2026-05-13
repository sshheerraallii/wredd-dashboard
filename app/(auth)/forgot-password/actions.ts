"use server";

import crypto from "crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { sendEmail } from "@/lib/email";

const prisma = getPrisma();

const ForgotSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

function okRedirect() {
  // Do NOT reveal whether email exists
  redirect(
    `/forgot-password?ok=${encodeURIComponent(
      "If that email exists, we sent a reset link."
    )}`
  );
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function requestPasswordReset(formData: FormData) {
  const parsed = ForgotSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) { okRedirect(); return; }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, archivedAt: true },
  });

  // Always same response
  if (!user) okRedirect();
  if (user.archivedAt) okRedirect();

  // Optional: revoke old unused reset tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = makeToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const link = `${appUrl}/reset-password?token=${rawToken}`;

  await sendEmail({
    to: user.email,
    subject: "Reset your WREDD password",
    html: `
      <div style="font-family:ui-sans-serif,system-ui; line-height:1.5;">
        <h2 style="margin:0 0 8px;">Reset password</h2>
        <p style="margin:0 0 16px;">Use the link below to set a new password.</p>
        <p style="margin:0 0 16px;">
          <a href="${link}" style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#8F4043;color:#fff;">
            Reset Password
          </a>
        </p>
        <p style="margin:0 0 6px;color:#666;font-size:12px;">If the button doesn’t work, copy/paste:</p>
        <p style="margin:0;color:#666;font-size:12px;">${link}</p>
        <p style="margin:16px 0 0;color:#666;font-size:12px;">This link expires in 60 minutes.</p>
      </div>
    `,
  });

  okRedirect();
}
