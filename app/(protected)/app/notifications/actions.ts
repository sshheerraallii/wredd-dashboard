"use server";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const prisma = getPrisma();

export async function markOneRead(formData: FormData) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/notifications?err=missing_id");

  await prisma.notification.updateMany({
    where: { id, userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/app/notifications");
  revalidatePath("/app");
}

export async function markAllRead() {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/app/notifications");
  revalidatePath("/app");
}
