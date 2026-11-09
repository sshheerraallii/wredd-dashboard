// app/(protected)/app/admin/targets/studio-actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();
const BASE = "/app/admin/targets";

const MonthKeySchema = z.string().regex(/^\d{4}-\d{2}$/, "monthKey must be YYYY-MM");

function back(monthKey: string, kind: "ok" | "err", msg: string): never {
  const mk = `monthKey=${encodeURIComponent(monthKey)}`;
  if (kind === "ok") redirect(`${BASE}?${mk}&ok=1&msg=${encodeURIComponent(msg)}`);
  redirect(`${BASE}?${mk}&err=${encodeURIComponent(msg)}`);
}

/**
 * Save each BD's USD target for the month (STUDIO model).
 * Inputs are named `target_<bdId>`. Blank removes that BD's target.
 */
export async function saveUsdTargets(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const mk = MonthKeySchema.safeParse(String(formData.get("monthKey") ?? "").trim());
  if (!mk.success) back(String(formData.get("monthKey") ?? ""), "err", "Invalid month");
  const monthKey = mk.data;

  const cfg = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { finalizedAt: true },
  });
  if (cfg?.finalizedAt) back(monthKey, "err", "This month is finalized (locked). Unfinalize it in Finance Config first.");

  const bds = await prisma.user.findMany({
    where: { role: "BUSINESS_DEVELOPER" as any, archivedAt: null },
    select: { id: true, fullName: true },
  });

  const upserts: { bdId: string; targetUsd: number }[] = [];
  const clears: string[] = [];

  for (const bd of bds) {
    const raw = String(formData.get(`target_${bd.id}`) ?? "").replace(/[$,]/g, "").trim();
    if (!raw) {
      clears.push(bd.id);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
      back(monthKey, "err", `${bd.fullName}: target must be a USD amount, 0 or more.`);
    }
    upserts.push({ bdId: bd.id, targetUsd: Math.round(n * 100) / 100 });
  }

  if (upserts.length === 0) back(monthKey, "err", "Enter at least one target.");

  await prisma.$transaction([
    prisma.bdMonthTarget.deleteMany({ where: { monthKey, bdId: { in: clears } } }),
    ...upserts.map((u) =>
      prisma.bdMonthTarget.upsert({
        where: { monthKey_bdId: { monthKey, bdId: u.bdId } },
        create: { monthKey, bdId: u.bdId, targetUsd: u.targetUsd.toFixed(2) },
        update: { targetUsd: u.targetUsd.toFixed(2) },
      })
    ),
  ]);

  revalidatePath(BASE);
  const total = upserts.reduce((a, u) => a + u.targetUsd, 0);
  back(monthKey, "ok", `Targets saved — $${total.toLocaleString()} across ${upserts.length} BD(s).`);
}
