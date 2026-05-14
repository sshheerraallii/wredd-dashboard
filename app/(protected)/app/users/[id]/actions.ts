"use server";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { v2 as cloudinary } from "cloudinary";

const prisma = getPrisma();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

async function fileToBuffer(file: File) {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

export async function updateMyProfile(formData: FormData) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  const fullNameRaw = String(formData.get("fullName") ?? "");
  const fullName = normalizeName(fullNameRaw);

  if (fullName.length < 2)
    redirect(`/app/users/${userId}?err=${encodeURIComponent("Full name too short")}`);
  if (fullName.length > 60)
    redirect(`/app/users/${userId}?err=${encodeURIComponent("Full name too long")}`);

  // Update name always
  await prisma.user.update({
    where: { id: userId },
    data: { fullName },
  });

  const file = formData.get("avatar") as File | null;

  // Avatar is optional
  if (!file || typeof file === "string" || file.size === 0) {
    redirect(`/app/users/${userId}?ok=${encodeURIComponent("Profile updated")}`);
  }

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    redirect(`/app/users/${userId}?err=${encodeURIComponent("Avatar must be JPG, PNG, or WEBP")}`);
  }

  if (file.size > 8_000_000) {
    redirect(`/app/users/${userId}?err=${encodeURIComponent("Avatar file too large (max 8MB input)")}`);
  }

  try {
    const buffer = await fileToBuffer(file);

    // Upload to Cloudinary
    // public_id is fixed per user so each upload overwrites the previous one
    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: `wredd/avatars/avatar_${userId}`,
            overwrite: true,
            resource_type: "image",
            format: "webp",
            transformation: [
              { width: 256, height: 256, crop: "fill", gravity: "face" },
              { quality: "auto" },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(buffer);
    });

    await prisma.user.update({
      where: { id: userId },
      data: { avatarPath: result.secure_url },
    });

    redirect(`/app/users/${userId}?ok=${encodeURIComponent("Profile updated")}`);
  } catch (e: any) {
    redirect(
      `/app/users/${userId}?err=${encodeURIComponent(e?.message || "Avatar upload failed")}`
    );
  }
}