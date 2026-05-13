"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/guards";

const prisma = getPrisma();

const DepartmentSchema = z.object({
  name: z.string().trim().min(2, "Too short").max(60, "Too long"),
});

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function generateUniqueSlug(base: string) {
  let slug = base;
  let i = 2;

  while (true) {
    const exists = await prisma.department.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!exists) return slug;
    slug = `${base}-${i++}`;
  }
}

function backWithError(msg: string) {
  redirect(`/app/admin/departments?err=${encodeURIComponent(msg)}`);
}

export async function createDepartment(formData: FormData) {
  const user = await requireRole(["SUPER_ADMIN", "MANAGER"]);
  await requireAdmin();

  const parsed = DepartmentSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    backWithError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const name = normalizeName(parsed.data.name);

  const nameExists = await prisma.department.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });

  if (nameExists) backWithError("Department already exists");

  const baseSlug = slugify(name);
  if (!baseSlug) backWithError("Invalid department name");

  const slug = await generateUniqueSlug(baseSlug);

  await prisma.department.create({ data: { name, slug } });

  revalidatePath("/app/admin/departments");
  redirect("/app/admin/departments?ok=1");
}

export async function updateDepartment(id: string, formData: FormData) {
  const user = await requireRole(["SUPER_ADMIN", "MANAGER"]);
  await requireAdmin();

  const parsed = DepartmentSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    redirect(
      `/app/admin/departments/${id}/edit?err=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "Invalid input"
      )}`
    );
  }

  const name = normalizeName(parsed.data.name);

  const exists = await prisma.department.findFirst({
    where: {
      id: { not: id },
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (exists) {
    redirect(
      `/app/admin/departments/${id}/edit?err=${encodeURIComponent(
        "Department already exists"
      )}`
    );
  }

  // IMPORTANT: slug stays unchanged on rename
  await prisma.department.update({
    where: { id },
    data: { name },
  });

  revalidatePath("/app/admin/departments");
  redirect(`/app/admin/departments/${id}/edit?ok=1`);
}

export async function deleteDepartment(id: string) {
  const user = await requireRole(["SUPER_ADMIN", "MANAGER"]);
  await requireAdmin();

  try {
    await prisma.department.delete({ where: { id } });
  } catch {
    redirect(
      `/app/admin/departments/${id}/edit?err=${encodeURIComponent(
        "Cannot delete: department is in use."
      )}`
    );
  }

  revalidatePath("/app/admin/departments");
  redirect("/app/admin/departments?ok=1");
}
