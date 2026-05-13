"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const prisma = getPrisma();

const schema = z.object({
  userId: z.string().min(1),
  ratePercent: z.string().trim().optional().default(""),
});

export async function updateBdCommissionRate(formData: FormData) {
  const session = await readSession();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/app?err=forbidden");

  const parsed = schema.parse({
    userId: String(formData.get("userId") ?? ""),
    ratePercent: String(formData.get("ratePercent") ?? ""),
  });

  // allow blank => null
  const raw = parsed.ratePercent;
  let next: Prisma.Decimal | null = null;

  if (raw.length) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      redirect("/app/admin/bd-config?err=Invalid%20rate%20(0..100)");
    }
    // percent -> fraction with 4dp
    const fraction = n / 100;
    next = new Prisma.Decimal(fraction.toFixed(4));
  }

  await prisma.user.update({
    where: { id: parsed.userId },
    data: { bdCommissionRate: next },
  });

  redirect("/app/admin/bd-config?ok=saved");
}