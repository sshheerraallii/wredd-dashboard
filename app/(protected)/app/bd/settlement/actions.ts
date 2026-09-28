// app/(protected)/app/bd/settlement/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";

/**
 * Super Admin only: override the hours a completed project uses in BD
 * settlement. Empty hours (or the "clear" button) removes the override and
 * falls back to allowedHours. Affects settlement only — not worker points,
 * accuracy or pace.
 */
export async function setSettlementHoursOverride(formData: FormData) {
  const session = await readSession();
  if (session?.user?.role !== "SUPER_ADMIN") redirect("/app?err=forbidden");

  const prisma = getPrisma();
  const id = String(formData.get("id") ?? "").trim();
  const clear = formData.get("clear") === "1";
  const rawHours = String(formData.get("hours") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "/app/bd/settlement");
  const safeReturn = returnTo.startsWith("/app/bd/settlement") ? returnTo : "/app/bd/settlement";

  if (!id) redirect(safeReturn);

  const row = await prisma.bdCommission.findUnique({
    where: { id },
    select: { workType: true, paidAt: true, exceptionPaidAt: true },
  });
  if (!row || String(row.workType) !== "ONSITE" || row.paidAt || row.exceptionPaidAt) {
    redirect(safeReturn);
  }

  let hours: number | null = null;
  if (!clear && rawHours !== "") {
    const n = Math.round(Number(rawHours));
    if (!Number.isFinite(n) || n < 0 || n > 10000) redirect(safeReturn);
    hours = n;
  }

  await prisma.bdCommission.update({
    where: { id },
    data:
      hours === null
        ? {
            hoursOverride: null,
            hoursOverrideById: null,
            hoursOverrideAt: null,
            hoursOverrideNote: null,
          }
        : {
            hoursOverride: hours,
            hoursOverrideById: session!.user!.id,
            hoursOverrideAt: new Date(),
            hoursOverrideNote: note || null,
          },
  });

  revalidatePath("/app/bd/settlement");
  redirect(safeReturn);
}
