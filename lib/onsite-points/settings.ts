import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Global onsite-points constants.
 *
 * These were historically only stored in the calculator's browser localStorage,
 * so the server could never read them. They now live in the SystemSetting
 * key-value table so estimated-points math can run server-side, and so a single
 * Super Admin control changes them everywhere at once.
 *
 * Defaults match the calculator's original defaults exactly, so if a row is
 * absent the server computes the same number you'd get by hand today.
 */

export const ONSITE_SETTING_KEYS = {
  productionMultiple: "onsite.productionMultiple",
  dollarsPerPoint: "onsite.dollarsPerPoint",
} as const;

export const ONSITE_DEFAULTS = {
  productionMultiple: 3,
  dollarsPerPoint: 6,
} as const;

export type OnsiteConstants = {
  productionMultiple: number;
  dollarsPerPoint: number;
};

function parseNum(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read both global constants. Falls back to defaults for any missing/invalid
 * row, so this never throws and always returns usable numbers.
 */
export async function getOnsiteConstants(): Promise<OnsiteConstants> {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            ONSITE_SETTING_KEYS.productionMultiple,
            ONSITE_SETTING_KEYS.dollarsPerPoint,
          ],
        },
      },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      productionMultiple: parseNum(
        map.get(ONSITE_SETTING_KEYS.productionMultiple),
        ONSITE_DEFAULTS.productionMultiple
      ),
      dollarsPerPoint: parseNum(
        map.get(ONSITE_SETTING_KEYS.dollarsPerPoint),
        ONSITE_DEFAULTS.dollarsPerPoint
      ),
    };
  } catch {
    return { ...ONSITE_DEFAULTS };
  }
}

/**
 * Upsert both constants. Caller is responsible for role-gating (Super Admin).
 */
export async function setOnsiteConstants(next: OnsiteConstants): Promise<void> {
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: ONSITE_SETTING_KEYS.productionMultiple },
      update: { value: String(next.productionMultiple) },
      create: {
        key: ONSITE_SETTING_KEYS.productionMultiple,
        value: String(next.productionMultiple),
      },
    }),
    prisma.systemSetting.upsert({
      where: { key: ONSITE_SETTING_KEYS.dollarsPerPoint },
      update: { value: String(next.dollarsPerPoint) },
      create: {
        key: ONSITE_SETTING_KEYS.dollarsPerPoint,
        value: String(next.dollarsPerPoint),
      },
    }),
  ]);
}
