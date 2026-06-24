import type { OnsiteConstants } from "./settings";

/**
 * Estimated onsite points engine.
 *
 * The number a worker will earn on a project is back-calculated from the hours
 * they were allocated (their own share of the work), using the same formula the
 * standalone calculator uses:
 *
 *   priceShareUsd = allocatedHours * (onsiteHourRatePkr / fxRate) * productionMultiple
 *   basePoints    = priceShareUsd / dollarsPerPoint
 *
 * basePoints is then scaled by the project's state (see STATE_FACTOR). Every
 * number here is ESTIMATED and explicitly "subject to change" — finalized
 * points are entered manually at completion and are never computed here.
 */

export type ProjectStatus =
  | "UNASSIGNED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "REVISION"
  | "COMPLETED"
  | "CANCELLED";

export type EstimateInputs = {
  allocatedHours: number | null | undefined;
  onsiteHourRatePkr: number | null | undefined;
  fxRate: number; // PKR per 1 USD
  /** Per-assignment snapshot, falling back to the current global value. */
  productionMultiple: number;
  dollarsPerPoint: number;
};

export type EstimateResult = {
  /** Full project points before the state factor, rounded. */
  basePoints: number;
  /** basePoints * stateFactor, rounded. What we actually show. */
  estimatedPoints: number;
  /** 0, 0.3, 0.7, or 1. */
  stateFactor: number;
  /** True when inputs were sufficient to compute a number. */
  computable: boolean;
};

/**
 * State -> portion of base points to surface as estimated.
 *  - first-pass IN_PROGRESS / REVISION (never delivered) -> 0.30
 *  - DELIVERED (or any state once delivered, except revision) -> 1.00
 *  - REVISION / bounced-back IN_PROGRESS after a delivery -> 0.70
 *  - COMPLETED -> finalized elsewhere, not estimated here (0)
 *  - CANCELLED / UNASSIGNED -> 0
 */
export function stateFactor(
  status: ProjectStatus,
  everDelivered: boolean
): number {
  switch (status) {
    case "DELIVERED":
      return 1;
    case "REVISION":
      return everDelivered ? 0.7 : 0.3;
    case "IN_PROGRESS":
      return everDelivered ? 0.7 : 0.3;
    case "UNASSIGNED":
    case "COMPLETED":
    case "CANCELLED":
    default:
      return 0;
  }
}

/**
 * Resolve everDelivered without requiring a backfill of firstDeliveredAt:
 * the current status or a recorded first completion already implies it for
 * all existing data.
 */
export function resolveEverDelivered(args: {
  firstDeliveredAt: Date | null | undefined;
  firstCompletedAt: Date | null | undefined;
  status: ProjectStatus;
}): boolean {
  if (args.firstDeliveredAt) return true;
  if (args.firstCompletedAt) return true;
  return (
    args.status === "DELIVERED" ||
    args.status === "REVISION" ||
    args.status === "COMPLETED"
  );
}

/** Back-calculate the full project base points from allocated hours. */
export function computeBasePoints(inputs: EstimateInputs): number | null {
  const { allocatedHours, onsiteHourRatePkr, fxRate, productionMultiple, dollarsPerPoint } = inputs;

  if (
    !allocatedHours ||
    !onsiteHourRatePkr ||
    !fxRate ||
    !productionMultiple ||
    !dollarsPerPoint ||
    allocatedHours <= 0 ||
    onsiteHourRatePkr <= 0 ||
    fxRate <= 0 ||
    productionMultiple <= 0 ||
    dollarsPerPoint <= 0
  ) {
    return null;
  }

  const hourlyUsd = onsiteHourRatePkr / fxRate;
  const priceShareUsd = allocatedHours * hourlyUsd * productionMultiple;
  const points = priceShareUsd / dollarsPerPoint;
  return Math.round(points);
}

/** Full estimate for one worker on one project. */
export function estimatePoints(
  inputs: EstimateInputs,
  status: ProjectStatus,
  everDelivered: boolean
): EstimateResult {
  const base = computeBasePoints(inputs);
  const factor = stateFactor(status, everDelivered);

  if (base == null) {
    return { basePoints: 0, estimatedPoints: 0, stateFactor: factor, computable: false };
  }

  return {
    basePoints: base,
    estimatedPoints: Math.round(base * factor),
    stateFactor: factor,
    computable: true,
  };
}

/** Pick the effective constants for an assignment: snapshot first, else global. */
export function effectiveConstants(
  snapshot: { prodMultipleSnapshot: number | null; dollarsPerPointSnapshot: number | null },
  globals: OnsiteConstants
): OnsiteConstants {
  return {
    productionMultiple: snapshot.prodMultipleSnapshot ?? globals.productionMultiple,
    dollarsPerPoint: snapshot.dollarsPerPointSnapshot ?? globals.dollarsPerPoint,
  };
}
