"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";

const prisma = getPrisma();

function editUrl(userId: string) {
  return `/app/admin/users/${userId}/edit`;
}

function backWithError(msg: string, userId?: string) {
  const base = userId ? editUrl(userId) : "/app/admin/users";
  redirect(`${base}?err=${encodeURIComponent(msg)}`);
}

function backOk(msg: string, userId: string) {
  redirect(`${editUrl(userId)}?ok=${encodeURIComponent(msg)}`);
}

export async function archiveUser(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const userId = String(formData.get("userId") || "");
  if (!userId) backWithError("Missing userId");

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, archivedAt: true },
  });
  if (!u) backWithError("User not found", userId);
  if (u.role === "SUPER_ADMIN") backWithError("Cannot archive SUPER_ADMIN", userId);

  await prisma.user.update({
    where: { id: userId },
    data: { archivedAt: new Date() },
  });

  revalidatePath("/app/admin/users");
  revalidatePath(editUrl(userId));
  backOk("User archived", userId);
}

export async function restoreUser(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const userId = String(formData.get("userId") || "");
  if (!userId) backWithError("Missing userId");

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!u) backWithError("User not found", userId);

  // HARD RULE: SUPER_ADMIN is protected
  if (u.role === "SUPER_ADMIN") backWithError("Cannot modify SUPER_ADMIN", userId);

  await prisma.user.update({
    where: { id: userId },
    data: { archivedAt: null },
  });

  revalidatePath("/app/admin/users");
  revalidatePath(editUrl(userId));
  backOk("User restored", userId);
}


export async function deleteUser(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const userId = String(formData.get("userId") || "");
  if (!userId) backWithError("Missing userId");

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      _count: {
        select: {
          assignments: true,
          messages: true,
          activities: true,
          ratingsGiven: true,
          paymentLines: true,
        },
      },
    },
  });

  if (!u) backWithError("User not found", userId);
  if (u.role === "SUPER_ADMIN") backWithError("Cannot delete SUPER_ADMIN", userId);

  const linked =
    u._count.assignments +
    u._count.messages +
    u._count.activities +
    u._count.ratingsGiven +
    u._count.paymentLines;

  if (linked > 0) {
    backWithError("Cannot delete: user has linked data. Archive instead.", userId);
  }

  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/app/admin/users");
  redirect(`/app/admin/users?ok=${encodeURIComponent("User deleted")}`);
}
