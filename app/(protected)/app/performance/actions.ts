"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

function backErr(userId: string, period: string, msg: string): never {
  redirect(
    `/app/performance?tab=onsite_employee&period=${period}&userId=${userId}&err=${encodeURIComponent(
      msg
    )}`
  );
}

function backOk(userId: string, period: string, msg: string): never {
  redirect(
    `/app/performance?tab=onsite_employee&period=${period}&userId=${userId}&ok=${encodeURIComponent(
      msg
    )}`
  );
}

function currentMonthKeyUTC(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const AddSchema = z.object({
  userId: z.string().min(1),
  period: z.string().optional(),
  // sign drives + / - ; magnitude is a positive integer
  sign: z.enum(["POSITIVE", "NEGATIVE"]),
  amount: z.coerce
    .number()
    .int("Points must be a whole number")
    .positive("Enter a positive number of points"),
  note: z.string().trim().min(1, "A note is required"),
  monthKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Bad month")
    .optional(),
});

export async function addManualPerformancePoint(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);
  const session = await readSession();

  const parsed = AddSchema.safeParse({
    userId: formData.get("userId"),
    period: formData.get("period"),
    sign: formData.get("sign"),
    amount: formData.get("amount"),
    note: formData.get("note"),
    monthKey: formData.get("monthKey") || undefined,
  });

  const period =
    (typeof formData.get("period") === "string" && formData.get("period")) ||
    "monthly";

  if (!parsed.success) {
    const uid = String(formData.get("userId") ?? "");
    backErr(uid, period as string, parsed.error.issues[0]?.message ?? "Invalid entry");
  }

  const { userId, sign, amount, note } = parsed.data;
  const monthKey = parsed.data.monthKey ?? currentMonthKeyUTC();
  const points = sign === "NEGATIVE" ? -amount : amount;

  // Guard: only allow manual points on actual onsite employees.
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target || target.role !== "ONSITE_EMPLOYEE") {
    backErr(userId, period as string, "Manual points apply to onsite employees only");
  }

  await prisma.manualPerformancePoint.create({
    data: {
      userId,
      points,
      note,
      monthKey,
      createdById: (session?.user as any)?.id ?? null,
    },
  });

  revalidatePath("/app/performance");
  backOk(
    userId,
    period as string,
    `${points > 0 ? "+" : ""}${points} manual point${Math.abs(points) === 1 ? "" : "s"} added (${monthKey}).`
  );
}

const DeleteSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  period: z.string().optional(),
});

export async function deleteManualPerformancePoint(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const parsed = DeleteSchema.safeParse({
    id: formData.get("id"),
    userId: formData.get("userId"),
    period: formData.get("period"),
  });

  const period =
    (typeof formData.get("period") === "string" && formData.get("period")) ||
    "monthly";

  if (!parsed.success) {
    const uid = String(formData.get("userId") ?? "");
    backErr(uid, period as string, "Could not delete entry");
  }

  // Ensure the entry belongs to the stated user before deleting.
  const entry = await prisma.manualPerformancePoint.findUnique({
    where: { id: parsed.data.id },
    select: { userId: true },
  });
  if (!entry || entry.userId !== parsed.data.userId) {
    backErr(parsed.data.userId, period as string, "Entry not found");
  }

  await prisma.manualPerformancePoint.delete({ where: { id: parsed.data.id } });

  revalidatePath("/app/performance");
  backOk(parsed.data.userId, period as string, "Manual entry removed.");
}
