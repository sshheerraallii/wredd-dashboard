// app/(protected)/app/admin/finance-config/actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { BdCommissionTab } from "@prisma/client";
import { upsertBdCommissionForProject } from "@/lib/bd-commission/upsert-bd-commission";
import { setOnsiteConstants } from "@/lib/onsite-points/settings";
import {
  getOnsiteOverheadSettings,
  setOnsiteOverheadSettings,
} from "@/lib/onsite-points/overhead-settings";

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
    select: { finalizedAt: true, fxRate: true },
  });

  if (!existing) {
    redirect(`/app/admin/finance-config?err=${encodeURIComponent("Month not found. Create it first.")}`);
  }

  if (existing.finalizedAt) {
    redirect(`/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1`);
  }

  // ── GUARD: block finalization with zero FX rate ──────────────────────────
  const fxNum = Number(existing.fxRate?.toString?.() ?? "0");
  if (!fxNum || fxNum <= 0) {
    redirect(
      `/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&err=${encodeURIComponent(
        "Cannot finalize — FX Rate is 0. Set the correct USD → PKR rate first."
      )}`
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  await prisma.monthlyFinanceConfig.update({
    where: { monthKey },
    data: { finalizedAt: new Date() },
  });

  redirect(`/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1`);
}

// ── UNFINALIZE ────────────────────────────────────────────────────────────────
// Super Admin can unlock a finalized month to correct values before re-finalizing.
// Safe to use at any time — does not touch BdCommission rows.
export async function unfinalizeMonth(formData: FormData) {
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

  await prisma.monthlyFinanceConfig.updateMany({
    where: { monthKey },
    data: { finalizedAt: null },
  });

  redirect(
    `/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1&msg=${encodeURIComponent(
      "Month unlocked. Edit values and re-finalize when ready."
    )}`
  );
}

// ── RECALCULATE MONTH ─────────────────────────────────────────────────────────
// Re-runs upsertBdCommissionForProject for every project that completed in this
// month. Skips any project whose commission row is already PAID / EXCEPTION_PAID
// to protect audited records.
//
// When to use:
//   - After correcting fxRate / avgOnsiteHourCostPkr in a finalized month
//   - After manually patching project finance data
//   - Any time BD commission figures look wrong for a given month
export async function recalculateMonth(formData: FormData) {
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

  // Verify config exists and has a non-zero fxRate before recalculating
  const config = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { fxRate: true },
  });

  if (!config) {
    redirect(
      `/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&err=${encodeURIComponent(
        "Month config not found. Create it first."
      )}`
    );
  }

  const fxNum = Number(config.fxRate?.toString?.() ?? "0");
  if (!fxNum || fxNum <= 0) {
    redirect(
      `/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&err=${encodeURIComponent(
        "FX Rate is still 0. Update the rate first, then recalculate."
      )}`
    );
  }

  // Date range for the month
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));       // e.g. 2026-06-01 UTC
  const end   = new Date(Date.UTC(y, m,     1));       // e.g. 2026-07-01 UTC

  // Find all eligible projects completed in this month.
  // Exclude projects whose commission row is already PAID (protect audited records).
  const projects = await prisma.project.findMany({
    where: {
      firstCompletedAt: { gte: start, lt: end },
      bdOwnerId: { not: null },
      finance: { isNot: null },
      bdCommissions: {
        none: { tab: BdCommissionTab.PAID },
      },
    },
    select: { id: true },
  });

  // Run upserts sequentially to avoid overwhelming the connection pool
  let recalcCount = 0;
  for (const p of projects) {
    await upsertBdCommissionForProject(p.id);
    recalcCount++;
  }

  redirect(
    `/app/admin/finance-config?monthKey=${encodeURIComponent(monthKey)}&ok=1&msg=${encodeURIComponent(
      `Recalculated ${recalcCount} commission row${recalcCount !== 1 ? "s" : ""} for ${monthKey}.`
    )}`
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Global onsite-points constants (productionMultiple, dollarsPerPoint)
// These are NOT per-month — they live in SystemSetting and drive the calculators
// and estimated-points math everywhere. Changes apply going forward only
// (existing assignments keep their snapshotted values).
// ─────────────────────────────────────────────────────────────────────────────

const OnsiteConstantsSchema = z.object({
  productionMultiple: z.coerce
    .number()
    .positive("Production Multiple must be greater than 0")
    .max(100, "Production Multiple looks too large"),
  dollarsPerPoint: z.coerce
    .number()
    .int("Dollars Per Point must be a whole number")
    .positive("Dollars Per Point must be greater than 0")
    .max(1000, "Dollars Per Point looks too large"),
});

export async function updateOnsiteConstants(formData: FormData) {
  const { user } = await readSession();
  requireSuperAdmin(user?.role);

  const parsed = OnsiteConstantsSchema.safeParse({
    productionMultiple: formData.get("productionMultiple"),
    dollarsPerPoint: formData.get("dollarsPerPoint"),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid values";
    redirect(`/app/admin/finance-config?err=${encodeURIComponent(msg)}`);
  }

  await setOnsiteConstants({
    productionMultiple: parsed.data.productionMultiple,
    dollarsPerPoint: parsed.data.dollarsPerPoint,
  });

  redirect(
    `/app/admin/finance-config?ok=1&msg=${encodeURIComponent(
      "Onsite points constants saved. Applies to new assignments going forward."
    )}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onsite hourly-rate model (global)
//
//   onsiteHourRatePkr = (monthlySalary / (workingDays * effectiveHours))
//                       + departmentOverheadPkrPerHour
//
// The department overhead is baked into every worker's stored rate, so the BD
// department cost base strips it back out to recover the bare salary. Editing
// these values does NOT rewrite existing worker rates — it changes what new
// rates should be, and what the implied-salary readout on each user's edit page
// reports. Re-enter affected worker rates after changing anything here.
// ─────────────────────────────────────────────────────────────────────────────

const OnsiteOverheadSchema = z.object({
  animationPkrPerHour: z.coerce
    .number()
    .min(0, "Animation overhead must be >= 0")
    .max(100000, "Animation overhead looks too large"),
  videoEditingPkrPerHour: z.coerce
    .number()
    .min(0, "Video Editing overhead must be >= 0")
    .max(100000, "Video Editing overhead looks too large"),
  workingDaysPerMonth: z.coerce
    .number()
    .positive("Working days must be greater than 0")
    .max(31, "Working days must be <= 31"),
  effectiveHoursPerDay: z.coerce
    .number()
    .positive("Effective hours must be greater than 0")
    .max(24, "Effective hours must be <= 24"),
});

export async function updateOnsiteOverheads(formData: FormData) {
  const session = await readSession();
  requireSuperAdmin(session?.user?.role);

  const parsed = OnsiteOverheadSchema.safeParse({
    animationPkrPerHour: formData.get("animationPkrPerHour"),
    videoEditingPkrPerHour: formData.get("videoEditingPkrPerHour"),
    workingDaysPerMonth: formData.get("workingDaysPerMonth"),
    effectiveHoursPerDay: formData.get("effectiveHoursPerDay"),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid values";
    redirect(`/app/admin/finance-config?err=${encodeURIComponent(msg)}`);
  }

  const before = await getOnsiteOverheadSettings();
  const next = parsed.data;

  await setOnsiteOverheadSettings({
    animationPkrPerHour: Math.round(next.animationPkrPerHour),
    videoEditingPkrPerHour: Math.round(next.videoEditingPkrPerHour),
    workingDaysPerMonth: next.workingDaysPerMonth,
    effectiveHoursPerDay: next.effectiveHoursPerDay,
  });

  const divisorChanged =
    before.workingDaysPerMonth !== next.workingDaysPerMonth ||
    before.effectiveHoursPerDay !== next.effectiveHoursPerDay;

  const msg = divisorChanged
    ? "Rate model saved. The sellable-hours divisor changed — every existing worker rate now implies a different salary. Re-enter onsite hour rates before the next commission run."
    : "Rate model saved. Existing worker rates are unchanged — re-enter them if the overhead moved.";

  redirect(`/app/admin/finance-config?ok=1&msg=${encodeURIComponent(msg)}`);
}
