import { getPrisma } from "@/lib/prisma";
import { BdCommissionTab } from "@prisma/client";

/**
 * Keeps BdCommission ledger tabs consistent over time.
 *
 * Rules:
 * - CLEARING -> DUE when dueOn <= now
 * - NEVER allow ACTIVE to exist in BdCommission (ACTIVE is UI-only)
 *
 * NOTE:
 * - We intentionally do NOT auto-move to PAID.
 *   PAID should be set only by an explicit payment action (paidAt/exceptionPaidAt).
 */
export async function resolveBdCommissionTabs(monthKey?: string) {
  const prisma = getPrisma();
  const now = new Date();

  // 0) Safety net: if any legacy rows exist with ACTIVE, force them into CLEARING.
  // ACTIVE is a UI-only concept (projects not completed yet) and must not exist in BdCommission.
  await prisma.bdCommission.updateMany({
    where: {
      tab: "ACTIVE" as any, // in case enum still contains ACTIVE in DB
      ...(monthKey ? { completedMonthKey: monthKey } : {}),
    },
    data: { tab: BdCommissionTab.CLEARING },
  });

  // 1) Move CLEARING -> DUE when dueOn hits
  await prisma.bdCommission.updateMany({
    where: {
      tab: BdCommissionTab.CLEARING,
      dueOn: { lte: now },
      ...(monthKey ? { completedMonthKey: monthKey } : {}),
    },
    data: { tab: BdCommissionTab.DUE },
  });

  // 2) Optional: If something was marked paid but tab wasn't updated, normalize it.
  // This prevents "paidAt set but still in DUE/CLEARING" data drift.
  await prisma.bdCommission.updateMany({
    where: {
      tab: { in: [BdCommissionTab.CLEARING, BdCommissionTab.DUE] },
      OR: [{ paidAt: { not: null } }, { exceptionPaidAt: { not: null } }],
      ...(monthKey ? { completedMonthKey: monthKey } : {}),
    },
    data: { tab: BdCommissionTab.PAID },
  });
}