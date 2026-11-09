import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Shared with createMonth: copy recurring lines forward, skipping any label the
 * month already has so a second click never duplicates.
 */
export async function copyRecurringInto(
  monthKey: string
): Promise<{ count: number; from: string | null }> {
  const prior = await prisma.monthlyExpense.findFirst({
    where: { monthKey: { lt: monthKey }, recurring: true },
    orderBy: { monthKey: "desc" },
    select: { monthKey: true },
  });
  if (!prior) return { count: 0, from: null };

  const [source, existing] = await Promise.all([
    prisma.monthlyExpense.findMany({
      where: { monthKey: prior.monthKey, recurring: true },
      select: { category: true, label: true, amountPkr: true, note: true, createdById: true },
    }),
    prisma.monthlyExpense.findMany({ where: { monthKey }, select: { label: true } }),
  ]);

  const have = new Set(existing.map((e) => e.label.toLowerCase()));
  const rows = source.filter((s) => !have.has(s.label.toLowerCase()));
  if (rows.length === 0) return { count: 0, from: prior.monthKey };

  await prisma.monthlyExpense.createMany({
    data: rows.map((r) => ({ ...r, monthKey, recurring: true })),
  });
  return { count: rows.length, from: prior.monthKey };
}
