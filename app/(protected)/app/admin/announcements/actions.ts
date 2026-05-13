"use server";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import path from "path";
import fs from "fs/promises";

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

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function fileToBuffer(file: File) {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

export async function uploadProjectBanners(formData: FormData) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  if (!requireManager(role)) redirect("/app?err=forbidden");

  const files = formData.getAll("banners") as File[];
  const picked = files.filter((f) => f && typeof f !== "string" && f.size > 0);

  if (!picked.length)
    redirect(
      "/app/admin/announcements?err=" + encodeURIComponent("No files selected")
    );
  if (picked.length > 4)
    redirect(
      "/app/admin/announcements?err=" + encodeURIComponent("Max 4 banners")
    );

  const allowed = ["image/jpeg", "image/png"];
  for (const f of picked) {
    if (!allowed.includes(f.type)) {
      redirect(
        "/app/admin/announcements?err=" +
          encodeURIComponent("Only JPG/PNG allowed")
      );
    }
    if (f.size > 5_000_000) {
      redirect(
        "/app/admin/announcements?err=" +
          encodeURIComponent("Each file must be <= 5MB")
      );
    }
  }

  const absDir = path.join(process.cwd(), "public", "announcements", "projects");
  await ensureDir(absDir);

  // Clear existing images
  const existing = await fs.readdir(absDir).catch(() => []);
  await Promise.all(
    existing
      .filter((n) => /\.(jpg|jpeg|png)$/i.test(n))
      .map((n) => fs.unlink(path.join(absDir, n)).catch(() => null))
  );

  const slides: string[] = [];

  // Write new ones as 01.jpg / 02.png ...
  for (let i = 0; i < picked.length; i++) {
    const f = picked[i];
    const buf = await fileToBuffer(f);

    const ext = f.type === "image/png" ? "png" : "jpg";
    const name = String(i + 1).padStart(2, "0") + "." + ext;

    await fs.writeFile(path.join(absDir, name), buf);
    slides.push(name);
  }

  // Write manifest (so UI can reliably know what to show)
  await fs.writeFile(
    path.join(absDir, "manifest.json"),
    JSON.stringify({ slides }, null, 2),
    "utf8"
  );

  redirect(
    "/app/admin/announcements?ok=" + encodeURIComponent("Banners uploaded")
  );
}
