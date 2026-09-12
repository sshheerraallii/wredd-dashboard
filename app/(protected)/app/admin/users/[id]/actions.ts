"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/guards";
import {
  firstOfMonthUTC,
  parseEffectiveFrom,
  recordUserRateChange,
} from "@/lib/user-rates/history";

const prisma = getPrisma();

function backWithError(userId: string, msg: string) {
  redirect(`/app/admin/users/${userId}/edit?err=${encodeURIComponent(msg)}`);
}


function backWithOk(userId: string) {
  redirect(`/app/admin/users/${userId}/edit?ok=${encodeURIComponent("Saved")}`);
}

export async function updateUserPerformance(userId: string, formData: FormData) {
  const actor = await requireRole(["SUPER_ADMIN", "MANAGER"]);
  await requireAdmin();

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) backWithError(userId, "User not found");

  if (target.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    backWithError(userId, "SUPER_ADMIN is protected.");
  }

  const Schema = z.object({
    targetMonthlyPoints: z.coerce.number().int().min(0).max(100000),
    joinedAt: z.string().min(10),
    onsiteHourRatePkr: z.coerce.number().int().min(0).max(10000000).nullable().optional(),
    rateEffectiveFrom: z.string().optional().nullable(),
    rateNote: z.string().max(500).optional().nullable(),
  });

  const parsed = Schema.safeParse({
    targetMonthlyPoints: formData.get("targetMonthlyPoints"),
    joinedAt: formData.get("joinedAt"),
    onsiteHourRatePkr: formData.get("onsiteHourRatePkr") || null,
    rateEffectiveFrom: (formData.get("rateEffectiveFrom") as string | null) ?? null,
    rateNote: (formData.get("rateNote") as string | null) ?? null,
  });

  if (!parsed.success) backWithError(userId, parsed.error.issues[0]?.message ?? "Invalid input");

  const joinedAt = new Date(parsed.data.joinedAt + "T00:00:00.000Z");
  if (Number.isNaN(joinedAt.getTime())) backWithError(userId, "Invalid joinedAt");

  // Effective date defaults to the 1st of the current month: salaries, targets
  // and commissions are all monthly, so a mid-month date would split the month
  // across two rates. Backdating and forward-dating are allowed.
  const data = parsed.data!;

  const effectiveFrom =
    (data.rateEffectiveFrom
      ? parseEffectiveFrom(data.rateEffectiveFrom)
      : null) ?? firstOfMonthUTC(new Date());

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { joinedAt },
    });

    // Writes the history row AND re-syncs the current values on User from
    // whichever row is latest, so a backdated correction cannot clobber a
    // newer rate.
    await recordUserRateChange(
      {
        userId,
        effectiveFrom,
        onsiteHourRatePkr: data.onsiteHourRatePkr ?? null,
        targetMonthlyPoints: data.targetMonthlyPoints,
        note: data.rateNote?.trim() || null,
        createdById: (actor?.id as string) ?? null,
      },
      tx
    );
  });

  revalidatePath(`/app/admin/users/${userId}/edit`);
  backWithOk(userId);
}


export async function updateUserDepartments(userId: string, formData: FormData) {
  const actor = await requireRole(["SUPER_ADMIN", "MANAGER"]);
  await requireAdmin();

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!target) backWithError(userId, "User not found");

  // HARD RULE: only SUPER_ADMIN can modify SUPER_ADMIN
  if (target.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    backWithError(userId, "SUPER_ADMIN is protected.");
  }

  // Checkboxes: name="departmentIds" value="<id>"
  const raw = formData.getAll("departmentIds");

  const parsed = z.array(z.string().min(1)).safeParse(raw);
  if (!parsed.success) backWithError(userId, "Invalid departments selection");

  const departmentIds = Array.from(new Set(parsed.data));

  if (departmentIds.length > 0) {
    const existing = await prisma.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true },
    });

    if (existing.length !== departmentIds.length) {
      backWithError(userId, "One or more departments are invalid");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.userDepartment.deleteMany({ where: { userId } });

    if (departmentIds.length > 0) {
      await tx.userDepartment.createMany({
        data: departmentIds.map((departmentId) => ({
          userId,
          departmentId,
        })),
        skipDuplicates: true,
      });
    }
  });

  revalidatePath(`/app/admin/users/${userId}/edit`);
  redirect(`/app/admin/users/${userId}/edit?ok=1`);
}
