// app/(protected)/app/admin/finance-config/studio-actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";
import { parseDateUTC } from "@/lib/studio/cost-model";
import { copyRecurringInto } from "@/lib/studio/expenses";

const prisma = getPrisma();
const BASE = "/app/admin/finance-config";

const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "monthKey must be YYYY-MM")
  .refine((v) => {
    const m = Number(v.split("-")[1]);
    return m >= 1 && m <= 12;
  }, "Invalid monthKey");

const CategorySchema = z.enum(["RENT", "BILLS", "AI_SUBSCRIPTION", "SALARY", "OTHER"]);

function back(monthKey: string, kind: "ok" | "err", msg: string): never {
  const mk = monthKey ? `monthKey=${encodeURIComponent(monthKey)}&` : "";
  if (kind === "ok") redirect(`${BASE}?${mk}ok=1&msg=${encodeURIComponent(msg)}`);
  redirect(`${BASE}?${mk}err=${encodeURIComponent(msg)}`);
}

async function assertMonthEditable(monthKey: string) {
  const cfg = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey },
    select: { finalizedAt: true },
  });
  if (!cfg) back(monthKey, "err", "Create the month first.");
  if (cfg.finalizedAt) back(monthKey, "err", "This month is finalized (locked). Unfinalize to edit expenses.");
}

function parseAmount(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

// ───────────────────────────────────────────────────────── cost model log

export async function addCostModelChange(formData: FormData) {
  const actor = await requireRole(["SUPER_ADMIN"]);
  const monthKey = String(formData.get("monthKey") ?? "");

  const effectiveFrom = parseDateUTC(String(formData.get("effectiveFrom") ?? ""));
  if (!effectiveFrom) back(monthKey, "err", "Pick a valid effective date.");

  const model = z.enum(["STAFF", "STUDIO"]).safeParse(formData.get("model"));
  if (!model.success) back(monthKey, "err", "Pick a cost model.");

  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;

  await prisma.costModelChange.upsert({
    where: { effectiveFrom },
    create: { effectiveFrom, model: model.data, note, createdById: (actor?.id as string) ?? null },
    update: { model: model.data, note, createdById: (actor?.id as string) ?? null },
  });

  revalidatePath(BASE);
  back(monthKey, "ok", `Cost model ${model.data} from ${effectiveFrom.toISOString().slice(0, 10)} saved.`);
}

export async function deleteCostModelChange(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);
  const monthKey = String(formData.get("monthKey") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) back(monthKey, "err", "Missing change id.");

  await prisma.costModelChange.delete({ where: { id } }).catch(() => null);
  revalidatePath(BASE);
  back(monthKey, "ok", "Cost model change removed.");
}

// ───────────────────────────────────────────────────────── expense ledger

export async function addExpense(formData: FormData) {
  const actor = await requireRole(["SUPER_ADMIN"]);

  const mk = MonthKeySchema.safeParse(String(formData.get("monthKey") ?? "").trim());
  if (!mk.success) back("", "err", mk.error.issues[0]?.message ?? "Invalid month");
  const monthKey = mk.data;
  await assertMonthEditable(monthKey);

  const category = CategorySchema.safeParse(formData.get("category"));
  if (!category.success) back(monthKey, "err", "Pick a category.");

  const label = String(formData.get("label") ?? "").trim();
  if (label.length < 2 || label.length > 120) back(monthKey, "err", "Label must be 2–120 characters.");

  const amountPkr = parseAmount(formData.get("amountPkr"));
  if (amountPkr == null) back(monthKey, "err", "Amount must be a number of PKR, 0 or more.");

  await prisma.monthlyExpense.create({
    data: {
      monthKey,
      category: category.data,
      label,
      amountPkr,
      recurring: formData.get("recurring") === "on",
      note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
      createdById: (actor?.id as string) ?? null,
    },
  });

  revalidatePath(BASE);
  back(monthKey, "ok", `Added: ${label}.`);
}

export async function updateExpense(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const id = String(formData.get("id") ?? "");
  const row = await prisma.monthlyExpense.findUnique({ where: { id }, select: { monthKey: true } });
  if (!row) back(String(formData.get("monthKey") ?? ""), "err", "Expense line not found.");
  await assertMonthEditable(row.monthKey);

  const category = CategorySchema.safeParse(formData.get("category"));
  if (!category.success) back(row.monthKey, "err", "Pick a category.");

  const label = String(formData.get("label") ?? "").trim();
  if (label.length < 2 || label.length > 120) back(row.monthKey, "err", "Label must be 2–120 characters.");

  const amountPkr = parseAmount(formData.get("amountPkr"));
  if (amountPkr == null) back(row.monthKey, "err", "Amount must be a number of PKR, 0 or more.");

  await prisma.monthlyExpense.update({
    where: { id },
    data: {
      category: category.data,
      label,
      amountPkr,
      recurring: formData.get("recurring") === "on",
    },
  });

  revalidatePath(BASE);
  back(row.monthKey, "ok", `Saved: ${label}.`);
}

export async function deleteExpense(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const id = String(formData.get("id") ?? "");
  const row = await prisma.monthlyExpense.findUnique({
    where: { id },
    select: { monthKey: true, label: true },
  });
  if (!row) back(String(formData.get("monthKey") ?? ""), "err", "Expense line not found.");
  await assertMonthEditable(row.monthKey);

  await prisma.monthlyExpense.delete({ where: { id } });
  revalidatePath(BASE);
  back(row.monthKey, "ok", `Removed: ${row.label}.`);
}

/** Copies the recurring lines of the most recent earlier month that has any. */
export async function copyRecurringExpenses(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const mk = MonthKeySchema.safeParse(String(formData.get("monthKey") ?? "").trim());
  if (!mk.success) back("", "err", mk.error.issues[0]?.message ?? "Invalid month");
  const monthKey = mk.data;
  await assertMonthEditable(monthKey);

  const copied = await copyRecurringInto(monthKey);
  revalidatePath(BASE);
  if (copied.count === 0) back(monthKey, "err", "No recurring lines found in earlier months.");
  back(monthKey, "ok", `Copied ${copied.count} recurring line(s) from ${copied.from}.`);
}
