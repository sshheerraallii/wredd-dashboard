// lib/bd-commission/monthKey.ts
import { DUE_DAY, PAYABLE_DAY } from "./constants";

/**
 * MonthKey format: YYYY-MM
 * Uses UTC to avoid timezone boundary bugs.
 */

export function toMonthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1..12
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) throw new Error(`Invalid monthKey: ${monthKey} (expected YYYY-MM)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }
  return { year, month };
}

export function firstOfMonthUtc(monthKey: string): Date {
  const { year, month } = parseMonthKey(monthKey);
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

export function addMonths(monthKey: string, delta: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const d = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return toMonthKey(d);
}

/**
 * Completed monthKey drives due/payable in the next month.
 * Example: completed 2026-02 => due 2026-03-01, payable 2026-03-10
 */
export function dueOnForCompletedMonthUtc(completedMonthKey: string): Date {
  const next = addMonths(completedMonthKey, 1);
  const base = firstOfMonthUtc(next);
  base.setUTCDate(DUE_DAY);
  return base;
}

export function payableOnForCompletedMonthUtc(completedMonthKey: string): Date {
  const next = addMonths(completedMonthKey, 1);
  const base = firstOfMonthUtc(next);
  base.setUTCDate(PAYABLE_DAY);
  return base;
}