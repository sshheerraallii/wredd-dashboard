// lib/bd-commission/shares.ts
import type { User } from "@prisma/client";

/**
 * Returns a number in [0,1]. Unset/invalid => 0.
 * We keep this permissive so the system runs even when Super Admin hasn't configured yet.
 */
export function getBdRateOrZero(user: Pick<User, "bdCommissionRate">): number {
  const raw = user.bdCommissionRate;
  if (raw == null) return 0;

  // Prisma Decimal -> string via toString()
  const n = typeof raw === "string" ? Number(raw) : Number(raw.toString());
  if (!Number.isFinite(n)) return 0;

  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function getCompanyRateFromBdRate(bdRate: number): number {
  const n = Number(bdRate);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 1;
  if (n >= 1) return 0;
  return 1 - n;
}

/**
 * Payout rule: BD payout never negative.
 */
export function calcBdShare(netProfitPkr: number, bdRate: number): number {
  const p = Number(netProfitPkr);
  const r = Number(bdRate);
  if (!Number.isFinite(p) || !Number.isFinite(r)) return 0;
  if (r <= 0) return 0; // no rate = no share (positive or negative)
  return p * r; // negative profit = negative BD share (loss absorption)
}

export function calcCompanyShare(netProfitPkr: number, bdRate: number): number {
  const p = Number(netProfitPkr);
  if (!Number.isFinite(p)) return 0;
  if (p <= 0) return 0;
  return p * getCompanyRateFromBdRate(bdRate);
}