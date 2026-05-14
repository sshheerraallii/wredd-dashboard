"use server";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function requireManager(role: Role | undefined) {
  return role === "SUPER_ADMIN" || role === "MANAGER";
}

async function fileToBuffer(file: File) {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

async function uploadToCloudinary(
  buffer: Buffer,
  publicId: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          public_id: publicId,
          overwrite: true,
          resource_type: "image",
          folder: "wredd/banners",
          transformation: [
            { quality: "auto", fetch_format: "auto" },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result!.secure_url);
        }
      )
      .end(buffer);
  });
}

export async function uploadProjectBanners(formData: FormData) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  if (!requireManager(role)) redirect("/app?err=forbidden");

  const files = formData.getAll("banners") as File[];
  const picked = files.filter((f) => f && typeof f !== "string" && f.size > 0);

  if (!picked.length)
    redirect("/app/admin/announcements?err=" + encodeURIComponent("No files selected"));
  if (picked.length > 4)
    redirect("/app/admin/announcements?err=" + encodeURIComponent("Max 4 banners"));

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  for (const f of picked) {
    if (!allowed.includes(f.type)) {
      redirect(
        "/app/admin/announcements?err=" + encodeURIComponent("Only JPG/PNG/WEBP allowed")
      );
    }
    if (f.size > 5_000_000) {
      redirect(
        "/app/admin/announcements?err=" + encodeURIComponent("Each file must be <= 5MB")
      );
    }
  }

  try {
    // Delete existing banner slots from Cloudinary
    await Promise.allSettled([
      cloudinary.uploader.destroy("wredd/banners/banner_01"),
      cloudinary.uploader.destroy("wredd/banners/banner_02"),
      cloudinary.uploader.destroy("wredd/banners/banner_03"),
      cloudinary.uploader.destroy("wredd/banners/banner_04"),
    ]);

    // Upload new banners
    const urls: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      const buf = await fileToBuffer(picked[i]);
      const publicId = `banner_0${i + 1}`;
      const url = await uploadToCloudinary(buf, publicId);
      urls.push(url);
    }

    // Store the manifest (banner URLs) in DB as a single system setting
    await prisma.systemSetting.upsert({
      where: { key: "announcement_banners" },
      update: { value: JSON.stringify(urls) },
      create: { key: "announcement_banners", value: JSON.stringify(urls) },
    });

    redirect("/app/admin/announcements?ok=" + encodeURIComponent("Banners uploaded"));
  } catch (e: any) {
    redirect(
      "/app/admin/announcements?err=" +
        encodeURIComponent(e?.message || "Upload failed")
    );
  }
}

export async function getBannerUrls(): Promise<string[]> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "announcement_banners" },
    });
    if (!setting) return [];
    return JSON.parse(setting.value) as string[];
  } catch {
    return [];
  }
}

export async function clearProjectBanners() {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  if (!requireManager(role)) redirect("/app?err=forbidden");

  try {
    await Promise.allSettled([
      cloudinary.uploader.destroy("wredd/banners/banner_01"),
      cloudinary.uploader.destroy("wredd/banners/banner_02"),
      cloudinary.uploader.destroy("wredd/banners/banner_03"),
      cloudinary.uploader.destroy("wredd/banners/banner_04"),
    ]);

    await prisma.systemSetting.upsert({
      where: { key: "announcement_banners" },
      update: { value: JSON.stringify([]) },
      create: { key: "announcement_banners", value: JSON.stringify([]) },
    });

    redirect("/app/admin/announcements?ok=" + encodeURIComponent("Banners cleared"));
  } catch (e: any) {
    redirect(
      "/app/admin/announcements?err=" +
        encodeURIComponent(e?.message || "Clear failed")
    );
  }
}