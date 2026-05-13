// lib/bd-commission/resolve.ts
import type { PrismaClient } from "@prisma/client";

/**
 * Idempotent resolver to keep BD commission ledger tabs consistent.
 *
 * Rules:
 * - DB ledger tabs are only: CLEARING | DUE | PAID
 * - Move CLEARING -> DUE when dueOn <= now
 * - Convert any legacy/invalid ACTIVE rows -> CLEARING (safe no-op if none)
 */
export async function resolveBdCommissionTabs(prisma: PrismaClient) {
  const now = new Date();

  // 1) Legacy ACTIVE -> CLEARING (only matters if old data exists)
  await prisma.bdCommission.updateMany({
    where: { tab: "ACTIVE" as any },
    data: { tab: "CLEARING" as any },
  });

  // 2) CLEARING -> DUE when due date reached (commissions)
  await prisma.bdCommission.updateMany({
    where: { tab: "CLEARING", dueOn: { lte: now } },
    data: { tab: "DUE" },
  });

  // 3) CLEARING -> DUE when due date reached (adjustments)
  await prisma.bdCommissionAdjustment.updateMany({
    where: { tab: "CLEARING", dueOn: { lte: now } },
    data: { tab: "DUE" },
  });
}