// app/(protected)/app/admin/targets/actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";
import { computeTargets } from "@/lib/bd-targets/compute";

const prisma = getPrisma();

const BASE = "/app/admin/targets";

const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "monthKey must be YYYY-MM")
  .refine((v) => {
    const [y, m] = v.split("-").map((x) => Number(x));
    return Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12;
  }, "Invalid monthKey");

function backErr(monthKey: string, msg: string) {
  redirect(`${BASE}?monthKey=${encodeURIComponent(monthKey)}&err=${encodeURIComponent(msg)}`);
}
function backOk(monthKey: string, msg: string) {
  redirect(`${BASE}?monthKey=${encodeURIComponent(monthKey)}&ok=1&msg=${encodeURIComponent(msg)}`);
}

/** Just navigate to a month (create/open box). No writes. */
export async function openMonth(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const parsed = MonthKeySchema.safeParse(String(formData.get("monthKey") ?? "").trim());
  if (!parsed.success) backErr("", parsed.error.issues[0]?.message ?? "invalid");
  redirect(`${BASE}?monthKey=${encodeURIComponent(parsed.data as string)}`);
}

/** Working days lives on MonthlyFinanceConfig (per-month config home). */
export async function saveWorkingDays(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const Schema = z.object({
    monthKey: MonthKeySchema,
    workingDays: z.coerce.number().int().min(1, "workingDays must be >= 1").max(31, "workingDays must be <= 31"),
  });
  const parsed = Schema.safeParse({
    monthKey: String(formData.get("monthKey") ?? "").trim(),
    workingDays: formData.get("workingDays"),
  });
  if (!parsed.success) {
    backErr(String(formData.get("monthKey") ?? ""), parsed.error.issues[0]?.message ?? "invalid");
  }
  const { monthKey, workingDays } = parsed.data!;

  // Upsert: if the month config row is missing, create it with the same
  // zero-defaults the Finance Config page uses when seeding a month.
  await prisma.monthlyFinanceConfig.upsert({
    where: { monthKey },
    create: {
      monthKey,
      fxRate: "0",
      avgOnsiteHourCostPkr: 0,
      remoteOverheadFixedPkr: 0,
      workingDays,
      notes: null,
      finalizedAt: null,
    },
    update: { workingDays },
  });

  backOk(monthKey, "Working days saved.");
}

/** Persist BD allocation %s for a month. Each department must sum to 100%. */
export async function saveAllocations(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const monthKeyRaw = String(formData.get("monthKey") ?? "").trim();
  const mk = MonthKeySchema.safeParse(monthKeyRaw);
  if (!mk.success) backErr(monthKeyRaw, mk.error.issues[0]?.message ?? "invalid monthKey");
  const monthKey = mk.data as string;

  const RowSchema = z.object({
    bdId: z.string().min(1),
    departmentId: z.string().min(1),
    sharePercent: z.coerce.number().min(0, "share must be >= 0").max(100, "share must be <= 100"),
  });
  const PayloadSchema = z.array(RowSchema);

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    backErr(monthKey, "Invalid payload");
  }
  const parsed = PayloadSchema.safeParse(rawPayload);
  if (!parsed.success) backErr(monthKey, parsed.error.issues[0]?.message ?? "Invalid rows");
  const rows = parsed.data!;

  if (rows.length === 0) backErr(monthKey, "Nothing to save");

  // Validate: each department's shares sum to 100 (small float tolerance).
  const byDept = new Map<string, number>();
  for (const r of rows) byDept.set(r.departmentId, (byDept.get(r.departmentId) ?? 0) + r.sharePercent);
  for (const [, total] of byDept) {
    if (Math.abs(total - 100) > 0.01) {
      backErr(monthKey, `Each department must total 100%. One column is at ${total.toFixed(2)}%.`);
    }
  }

  const deptIds = [...byDept.keys()];

  await prisma.$transaction(async (tx) => {
    // Replace the month's rows for exactly the departments we're saving.
    await tx.bdDepartmentAllocation.deleteMany({
      where: { monthKey, departmentId: { in: deptIds } },
    });
    await tx.bdDepartmentAllocation.createMany({
      data: rows.map((r) => ({
        monthKey,
        bdId: r.bdId,
        departmentId: r.departmentId,
        sharePercent: r.sharePercent,
      })),
    });
  });

  backOk(monthKey, "Allocations saved.");
}

/** Freeze target + achieved per department for the month (closed book). Manual only. */
export async function snapshotMonth(formData: FormData) {
  const user = await requireRole(["SUPER_ADMIN"]);

  const mk = MonthKeySchema.safeParse(String(formData.get("monthKey") ?? "").trim());
  if (!mk.success) backErr(String(formData.get("monthKey") ?? ""), mk.error.issues[0]?.message ?? "invalid monthKey");
  const monthKey = mk.data as string;

  const comp = await computeTargets(monthKey);
  const rows = comp.departments.filter((d) => d.deptId);
  if (rows.length === 0) backErr(monthKey, "No departments to snapshot. Set up Animations and Video Editing first.");

  const now = new Date();
  const snapshotById = (user?.id as string) ?? null;

  await prisma.$transaction(
    rows.map((d) =>
      prisma.bdTargetSnapshot.upsert({
        where: { monthKey_departmentId: { monthKey, departmentId: d.deptId as string } },
        create: {
          monthKey,
          departmentId: d.deptId as string,
          departmentName: d.name,
          targetPoints: d.capacityPoints,
          targetUsd: d.targetUsd,
          achievedUsd: d.buckets.achievedUsd,
          dollarsPerPoint: 6,
          snapshotAt: now,
          snapshotById,
        },
        update: {
          departmentName: d.name,
          targetPoints: d.capacityPoints,
          targetUsd: d.targetUsd,
          achievedUsd: d.buckets.achievedUsd,
          dollarsPerPoint: 6,
          snapshotAt: now,
          snapshotById,
        },
      })
    )
  );

  backOk(monthKey, "Month snapshotted (target + achieved frozen).");
}
