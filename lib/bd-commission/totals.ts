// lib/bd-commission/totals.ts
import { Prisma } from "@prisma/client";

function toNum(v: any) {
  const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export function sumCommissionTotals(rows: any[]) {
  const totals = {
    count: rows.length,
    profitPkr: 0,
    bdPayoutPkr: 0,
    companySharePkr: 0,
  };

  for (const r of rows) {
    totals.profitPkr += toNum(r.profitPkr);
    totals.bdPayoutPkr += toNum(r.bdPayoutPkr);
    totals.companySharePkr += toNum(r.companySharePkr);
  }
  return totals;
}

export function fmtMoneyPkr(n: number) {
  return Math.round(n).toLocaleString("en-PK");
}