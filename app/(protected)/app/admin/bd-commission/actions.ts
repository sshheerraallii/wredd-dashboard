// app/(protected)/app/admin/bd-commission/actions.ts
"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BdCommissionTab } from "@prisma/client";
import { computeDueOnForMonthKey } from "@/lib/bd-commission/due";

function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");
}

function asReturnTo(v?: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : undefined;
}

export async function markBdCommissionPaid(input: { id: string; note?: string; returnTo?: string }) {
  const prisma = getPrisma();
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  const schema = z.object({
    id: z.string().min(1),
    note: z.string().optional(),
    returnTo: z.string().optional(),
  });
  const { id, note, returnTo } = schema.parse(input);

  await prisma.bdCommission.update({
    where: { id },
    data: {
      tab: BdCommissionTab.PAID,
      paidAt: new Date(),
      paidNote: note ?? null,
      paidById: session!.user!.id,
    },
  });

  const rt = asReturnTo(returnTo);
  if (rt) redirect(rt);
}

export async function markBdCommissionExceptionPaid(input: { id: string; note: string; returnTo?: string }) {
  const prisma = getPrisma();
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  const schema = z.object({
    id: z.string().min(1),
    note: z.string().min(1),
    returnTo: z.string().optional(),
  });
  const { id, note, returnTo } = schema.parse(input);

  await prisma.bdCommission.update({
    where: { id },
    data: {
      tab: BdCommissionTab.PAID,
      exceptionPaidAt: new Date(),
      exceptionPaidNote: note,
      exceptionPaidById: session!.user!.id,
    },
  });

  const rt = asReturnTo(returnTo);
  if (rt) redirect(rt);
}

export async function createBdAdjustment(input: {
  bdUserId: string;
  monthKey: string; // YYYY-MM
  amountPkr: number | string;
  note: string;
  returnTo?: string;
}) {
  const prisma = getPrisma();
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  const schema = z.object({
    bdUserId: z.string().min(1),
    monthKey: z.string().regex(/^\d{4}-\d{2}$/),
    amountPkr: z.coerce.number().finite(),
    note: z.string().min(2).max(300),
    returnTo: z.string().optional(),
  });

  const { bdUserId, monthKey, amountPkr, note, returnTo } = schema.parse(input);

  const dueOn = computeDueOnForMonthKey(monthKey);
  const amountStr = amountPkr.toFixed(2);

  await prisma.bdCommissionAdjustment.create({
    data: {
      bdUserId,
      monthKey,
      tab: BdCommissionTab.CLEARING,
      amountPkr: amountStr,
      note,
      dueOn,
      createdById: session!.user!.id,
    },
  });

  const rt = asReturnTo(returnTo);
  if (rt) redirect(rt);
}

export async function markBdAdjustmentPaid(input: { id: string; returnTo?: string }) {
  const prisma = getPrisma();
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  const schema = z.object({
    id: z.string().min(1),
    returnTo: z.string().optional(),
  });

  const { id, returnTo } = schema.parse(input);

  await prisma.bdCommissionAdjustment.update({
    where: { id },
    data: {
      tab: BdCommissionTab.PAID,
      paidAt: new Date(),
    },
  });

  const rt = asReturnTo(returnTo);
  if (rt) redirect(rt);
}

/**
 * BULK: Mark many commission rows PAID (regular paidAt path)
 * - Only affects ids passed from UI
 */
export async function bulkMarkBdCommissionPaid(input: { ids: string[]; returnTo?: string }) {
  const prisma = getPrisma();
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  const schema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    returnTo: z.string().optional(),
  });
  const { ids, returnTo } = schema.parse(input);

  await prisma.bdCommission.updateMany({
    where: { id: { in: ids }, tab: BdCommissionTab.DUE },
    data: {
      tab: BdCommissionTab.PAID,
      paidAt: new Date(),
      paidNote: null,
      paidById: session!.user!.id,
    },
  });

  const rt = asReturnTo(returnTo);
  if (rt) redirect(rt);
}

/**
 * BULK: Mark many adjustment rows PAID
 */
export async function bulkMarkBdAdjustmentPaid(input: { ids: string[]; returnTo?: string }) {
  const prisma = getPrisma();
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  const schema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    returnTo: z.string().optional(),
  });
  const { ids, returnTo } = schema.parse(input);

  await prisma.bdCommissionAdjustment.updateMany({
    where: { id: { in: ids }, tab: BdCommissionTab.DUE },
    data: {
      tab: BdCommissionTab.PAID,
      paidAt: new Date(),
    },
  });

  const rt = asReturnTo(returnTo);
  if (rt) redirect(rt);
}