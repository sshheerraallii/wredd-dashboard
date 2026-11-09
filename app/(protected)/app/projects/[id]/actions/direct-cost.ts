"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";

const prisma = getPrisma();

function back(projectId: string, kind: "ok" | "err", msg: string): never {
  redirect(`/app/projects/${projectId}?${kind}=${encodeURIComponent(msg)}`);
}

/**
 * Money spent for THIS project only (credit top-up, stock clip, music licence).
 * Subscriptions belong in the monthly expense ledger, not here.
 * Blank clears it. Used by the STUDIO settlement (Patch 2b).
 */
export async function saveDirectCost(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) redirect("/app/projects");

  const raw = String(formData.get("directCostPkr") ?? "").replace(/,/g, "").trim();
  let directCostPkr: number | null = null;
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100_000_000) {
      back(projectId, "err", "Direct cost must be a PKR amount, 0 or more.");
    }
    directCostPkr = Math.round(n);
  }

  const updated = await prisma.projectFinance.updateMany({
    where: { projectId },
    data: { directCostPkr },
  });
  if (updated.count === 0) back(projectId, "err", "Project finance record not found.");

  revalidatePath(`/app/projects/${projectId}`);
  back(projectId, "ok", directCostPkr == null ? "Direct cost cleared." : "Direct cost saved.");
}
