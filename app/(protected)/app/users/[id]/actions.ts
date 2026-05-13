"use server";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";

const prisma = getPrisma();

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function fileToBuffer(file: File) {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

async function processAvatarToWebpUnder1MB(input: Buffer) {
  // Start at 256px square, reduce quality/size if needed to fit <= 1MB.
  let size = 256;
  let quality = 82;

  for (let attempt = 0; attempt < 10; attempt++) {
    const out = await sharp(input)
      .rotate() // respect EXIF
      .resize(size, size, { fit: "cover" })
      .webp({ quality })
      .toBuffer();

    if (out.length <= 1_000_000) return out;

    // tighten progressively
    if (quality > 55) quality -= 8;
    else if (size > 160) size -= 24;
    else quality -= 5;
  }

  throw new Error("Avatar could not be compressed under 1 MB.");
}

export async function updateMyProfile(formData: FormData) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  const fullNameRaw = String(formData.get("fullName") ?? "");
  const fullName = normalizeName(fullNameRaw);

  if (fullName.length < 2) redirect(`/app/users/${userId}?err=${encodeURIComponent("Full name too short")}`);
  if (fullName.length > 60) redirect(`/app/users/${userId}?err=${encodeURIComponent("Full name too long")}`);

  // Update name always
  await prisma.user.update({
    where: { id: userId },
    data: { fullName },
  });

  const file = formData.get("avatar") as File | null;

  // Avatar upload is optional
  if (!file || typeof file === "string" || file.size === 0) {
    redirect(`/app/users/${userId}?ok=${encodeURIComponent("Profile updated")}`);
  }

  // Basic type gate (server-side)
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    redirect(`/app/users/${userId}?err=${encodeURIComponent("Avatar must be JPG, PNG, or WEBP")}`);
  }

  // We accept larger than 1MB input, but we ALWAYS store output under 1MB.
  // Still cap absurd uploads for safety.
  if (file.size > 8_000_000) {
    redirect(`/app/users/${userId}?err=${encodeURIComponent("Avatar file too large (max 8MB input)")}`);
  }

  try {
    const input = await fileToBuffer(file);
    const processed = await processAvatarToWebpUnder1MB(input);

    const relDir = "/uploads/avatars";
    const absDir = path.join(process.cwd(), "public", "uploads", "avatars");
    await ensureDir(absDir);

    const filename = `avatar_${userId}.webp`; // overwrite -> no orphan files
    const absPath = path.join(absDir, filename);
    const relPath = `${relDir}/${filename}`;

    await fs.writeFile(absPath, processed);

    await prisma.user.update({
      where: { id: userId },
      data: { avatarPath: relPath },
    });

    redirect(`/app/users/${userId}?ok=${encodeURIComponent("Profile updated")}`);
  } catch (e: any) {
    redirect(`/app/users/${userId}?err=${encodeURIComponent(e?.message || "Avatar upload failed")}`);
  }
}
