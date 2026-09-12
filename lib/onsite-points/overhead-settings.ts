import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Onsite hourly-rate model (global, not per-month).
 *
 * A worker's stored `onsiteHourRatePkr` is built from two parts:
 *
 *   hourlyRate = (monthlySalary / sellableHoursPerMonth) + departmentOverhead
 *
 * where sellableHoursPerMonth = workingDaysPerMonth x effectiveHoursPerDay.
 *
 * The department overhead is the share of rent, electricity, internet,
 * management, subscriptions and ads carried by one hour of that department's
 * time. Because it is baked INTO the stored rate, anything that needs the bare
 * salary back has to strip it out again:
 *
 *   monthlySalary = (hourlyRate - departmentOverhead) * sellableHoursPerMonth
 *
 * Keep both directions in this one file so they can never drift apart.
 */

export const OVERHEAD_SETTING_KEYS = {
  animationPkrPerHour: "onsite.overhead.animationPkrPerHour",
  videoEditingPkrPerHour: "onsite.overhead.videoEditingPkrPerHour",
  workingDaysPerMonth: "onsite.overhead.workingDaysPerMonth",
  effectiveHoursPerDay: "onsite.overhead.effectiveHoursPerDay",
} as const;

export const OVERHEAD_DEFAULTS = {
  animationPkrPerHour: 322,
  videoEditingPkrPerHour: 219,
  workingDaysPerMonth: 25,
  effectiveHoursPerDay: 6.5,
} as const;

export type OnsiteOverheadSettings = {
  animationPkrPerHour: number;
  videoEditingPkrPerHour: number;
  workingDaysPerMonth: number;
  effectiveHoursPerDay: number;
};

function parseNum(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Sellable hours in one month. 25 x 6.5 = 162.5 by default. */
export function sellableHoursPerMonth(s: OnsiteOverheadSettings): number {
  const h = s.workingDaysPerMonth * s.effectiveHoursPerDay;
  return h > 0 ? h : 1;
}

/** Overhead PKR/hour for a worker type. Non-animator onsite roles use the VE rate. */
export function overheadForWorkerType(
  workerType: string | null | undefined,
  s: OnsiteOverheadSettings
): number {
  return workerType === "ONSITE_ANIMATOR"
    ? s.animationPkrPerHour
    : s.videoEditingPkrPerHour;
}

/** Forward: monthly salary -> stored hourly rate (rounded to whole PKR). */
export function hourlyRateFromSalary(
  monthlySalaryPkr: number,
  workerType: string | null | undefined,
  s: OnsiteOverheadSettings
): number {
  if (!Number.isFinite(monthlySalaryPkr) || monthlySalaryPkr < 0) return 0;
  const direct = monthlySalaryPkr / sellableHoursPerMonth(s);
  return Math.round(direct + overheadForWorkerType(workerType, s));
}

/** Reverse: stored hourly rate -> monthly salary (rounded to whole PKR). */
export function salaryFromHourlyRate(
  hourlyRatePkr: number | null | undefined,
  workerType: string | null | undefined,
  s: OnsiteOverheadSettings
): number {
  if (hourlyRatePkr == null || !Number.isFinite(hourlyRatePkr)) return 0;
  const direct = hourlyRatePkr - overheadForWorkerType(workerType, s);
  if (direct <= 0) return 0;
  return Math.round(direct * sellableHoursPerMonth(s));
}

/** Read all four settings. Never throws; falls back to defaults. */
export async function getOnsiteOverheadSettings(): Promise<OnsiteOverheadSettings> {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: Object.values(OVERHEAD_SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      animationPkrPerHour: parseNum(
        map.get(OVERHEAD_SETTING_KEYS.animationPkrPerHour),
        OVERHEAD_DEFAULTS.animationPkrPerHour
      ),
      videoEditingPkrPerHour: parseNum(
        map.get(OVERHEAD_SETTING_KEYS.videoEditingPkrPerHour),
        OVERHEAD_DEFAULTS.videoEditingPkrPerHour
      ),
      workingDaysPerMonth: parseNum(
        map.get(OVERHEAD_SETTING_KEYS.workingDaysPerMonth),
        OVERHEAD_DEFAULTS.workingDaysPerMonth
      ),
      effectiveHoursPerDay: parseNum(
        map.get(OVERHEAD_SETTING_KEYS.effectiveHoursPerDay),
        OVERHEAD_DEFAULTS.effectiveHoursPerDay
      ),
    };
  } catch {
    return { ...OVERHEAD_DEFAULTS };
  }
}

/** Upsert all four. Caller is responsible for role-gating (Super Admin). */
export async function setOnsiteOverheadSettings(
  next: OnsiteOverheadSettings
): Promise<void> {
  const pairs: [string, number][] = [
    [OVERHEAD_SETTING_KEYS.animationPkrPerHour, next.animationPkrPerHour],
    [OVERHEAD_SETTING_KEYS.videoEditingPkrPerHour, next.videoEditingPkrPerHour],
    [OVERHEAD_SETTING_KEYS.workingDaysPerMonth, next.workingDaysPerMonth],
    [OVERHEAD_SETTING_KEYS.effectiveHoursPerDay, next.effectiveHoursPerDay],
  ];

  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  );
}
