import { getPrisma } from "@/lib/prisma";

/**
 * Cost model switch — a dated log, not a per-month flag.
 *
 *   STAFF  = old absorption model (onsite salaries + overhead pool split by
 *            department capacity, BD load by department allocation %)
 *   STUDIO = expense ledger + BD USD targets
 *
 * The model in force on a date is the latest change with effectiveFrom <= date.
 * With no rows at all, everything is STAFF (history stays as it was).
 * A month that straddles a change is settled in segments (Patch 2b).
 */

export type CostModelName = "STAFF" | "STUDIO";

export type CostModelChangeRow = {
  id: string;
  effectiveFrom: Date;
  model: CostModelName;
  note: string | null;
};

export type MonthSegment = {
  model: CostModelName;
  /** inclusive, UTC midnight */
  from: Date;
  /** exclusive, UTC midnight */
  to: Date;
};

const prisma = getPrisma();

export async function listCostModelChanges(): Promise<CostModelChangeRow[]> {
  const rows = await prisma.costModelChange.findMany({
    orderBy: { effectiveFrom: "asc" },
    select: { id: true, effectiveFrom: true, model: true, note: true },
  });
  return rows.map((r) => ({ ...r, model: r.model as CostModelName }));
}

/** Model in force at `at`, given changes sorted ascending. */
export function costModelAt(at: Date, changes: CostModelChangeRow[]): CostModelName {
  let model: CostModelName = "STAFF";
  for (const c of changes) {
    if (c.effectiveFrom <= at) model = c.model;
    else break;
  }
  return model;
}

export function monthBoundsUTC(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

/**
 * Split a month into contiguous segments by cost model.
 * A month with no change inside it returns a single segment.
 */
export function monthSegments(monthKey: string, changes: CostModelChangeRow[]): MonthSegment[] {
  const { start, end } = monthBoundsUTC(monthKey);
  const cuts = changes
    .filter((c) => c.effectiveFrom > start && c.effectiveFrom < end)
    .map((c) => c.effectiveFrom);

  const bounds = [start, ...cuts, end];
  const segs: MonthSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const model = costModelAt(bounds[i], changes);
    const prev = segs[segs.length - 1];
    if (prev && prev.model === model) prev.to = bounds[i + 1];
    else segs.push({ model, from: bounds[i], to: bounds[i + 1] });
  }
  return segs;
}

/** True when any part of the month runs on the STUDIO model. */
export function monthUsesStudio(monthKey: string, changes: CostModelChangeRow[]): boolean {
  return monthSegments(monthKey, changes).some((s) => s.model === "STUDIO");
}

export async function expenseTotalPkr(monthKey: string): Promise<number> {
  const agg = await prisma.monthlyExpense.aggregate({
    where: { monthKey },
    _sum: { amountPkr: true },
  });
  return agg._sum.amountPkr ?? 0;
}

/** Parse "YYYY-MM-DD" to UTC midnight, or null. */
export function parseDateUTC(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const EXPENSE_CATEGORIES = [
  { value: "RENT", label: "Rent" },
  { value: "BILLS", label: "Bills" },
  { value: "AI_SUBSCRIPTION", label: "AI subscription" },
  { value: "SALARY", label: "Salary" },
  { value: "OTHER", label: "Other" },
] as const;

export type ExpenseCategoryValue = (typeof EXPENSE_CATEGORIES)[number]["value"];

export function expenseCategoryLabel(v: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}
