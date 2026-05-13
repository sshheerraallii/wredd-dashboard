// app/(protected)/app/admin/finance-config/actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

function requireSuperAdmin(role?: string) {
  if (role !== "SUPER_ADMIN") redirect("/app?err=forbidden");
}

const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "monthKey must be YYYY-MM")
  .refine((v) => {
    const [y, m] = v.split("-").map((x) => Number(x));
    return Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12;
  }, "Invalid monthKey");

const CreateSchema = z.object({
  monthKey: MonthKeySchema,
});

const UpdateSchema = z.object({
  monthKey: MonthKeySchema,
  fxRate: z.coerce.number().positive("fxRate must be > 0"),
  avgOnsiteHourCostPkr: z.coerce.number().min(0, "avgOnsiteHourCostPkr must be >= 0"),
  remoteOverheadFixedPkr: z.coerce.number().min(0, "remoteOverheadFixedPkr must be >= 0"),
  notes: z.string().max(2000).optional().nullable(),
});

const FinalizeSchema = z.object({
  monthKey: MonthKeySchema,
});

export async function createMonth(formData: FormData) {
  const { user } = await readSession();
  requireSuperAdmin(user?.role);

  const parsed = CreateSchema.safeParse({
    monthKey: String(formData.get("monthKey") ?? "").trim(),
  });
  if (!parsed.success) {
    redirect(
      `/app/admin/finance-config?err=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "invalid"
      )}`
    );
  }

  const monthKey = parsed.data.monthKey;

  await prisma.monthlyFinanceConfig.upsert({
    where: { monthKey },
    create: {
      monthKey,
      fxRate: "0",
      avgOnsiteHourCostPkr: 0,
      remoteOverheadFixedPkr: 0,
      notes: null,
      finalizedAt: null,
    },
    update: {},
  });

  redirect(`/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}`);
}

export async function updateMonth(formData: FormData) {
  const { user } = await readSession();
  requireSuperAdmin(user?.role);

  const raw = {
    monthKey: String(formData.get("monthKey") ?? "").trim(),
    fxRate: formData.get("fxRate"),
    avgOnsiteHourCostPkr: formData.get("avgOnsiteHourCostPkr"),
    remoteOverheadFixedPkr: formData.get("remoteOverheadFixedPkr"),
    notes: (formData.get("notes") as string | null) ?? null,
  };

  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(
      `/app/admin/finance-config?err=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "invalid"
      )}`
    );
  }

  const { monthKey, fxRate, avgOnsiteHourCostPkr, remoteOverheadFixedPkr, notes } = parsed.data;

  const existing = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { finalizedAt: true },
  });

  if (!existing) {
    redirect(`/app/admin/finance-config?err=${encodeURIComponent("Month not found. Create it first.")}`);
  }

  if (existing.finalizedAt) {
    redirect(
      `/app/admin/finance-config?monthKey=${encodeURIComponent(
        monthKey
      )}&err=${encodeURIComponent("This month is finalized (locked).")}`
    );
  }

  await prisma.monthlyFinanceConfig.update({
    where: { monthKey },
    data: {
      fxRate: fxRate.toFixed(4), // Decimal
      avgOnsiteHourCostPkr: Math.round(avgOnsiteHourCostPkr), // INT
      remoteOverheadFixedPkr: Math.round(remoteOverheadFixedPkr), // INT
      notes: notes?.trim() ? notes.trim() : null,
    },
  });

  redirect(`/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1`);
}

export async function finalizeMonth(formData: FormData) {
  const { user } = await readSession();
  requireSuperAdmin(user?.role);

  const parsed = FinalizeSchema.safeParse({
    monthKey: String(formData.get("monthKey") ?? "").trim(),
  });
  if (!parsed.success) {
    redirect(
      `/app/admin/finance-config?err=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "invalid"
      )}`
    );
  }

  const monthKey = parsed.data.monthKey;

  const existing = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { finalizedAt: true },
  });

  if (!existing) {
    redirect(`/app/admin/finance-config?err=${encodeURIComponent("Month not found. Create it first.")}`);
  }

  if (existing.finalizedAt) {
    redirect(`/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1`);
  }

  await prisma.monthlyFinanceConfig.update({
    where: { monthKey },
    data: { finalizedAt: new Date() },
  });

  redirect(`/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1`);
}