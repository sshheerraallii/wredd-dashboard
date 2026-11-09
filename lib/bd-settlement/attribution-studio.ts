import type { BdSettlement } from "./compute";

/**
 * Per-project lines for a STUDIO (or MIXED) settlement that ADD UP to the
 * settlement exactly.
 *
 *   per project  = (net - remote - direct cost - charge) x rate
 *                  charge = price x k (STUDIO) or hours x BD hour rate (STAFF part)
 *   target line  = settlement commission (unfloored) - sum of project lines
 *
 * The target line is the unsold part of the target (negative) or, when the BD
 * has sold beyond the target so far, the over-target credit (positive): sales
 * past the target carry no extra expense. For a MIXED month it also holds the
 * STAFF part's unused capacity.
 */

export type StudioAttributedProject = {
  projectId: string;
  bdCommissionId: string;
  title: string;
  workType: string;
  model: "STAFF" | "STUDIO";
  priceUsd: number;
  netPkr: number;
  remotePayoutPkr: number;
  directCostPkr: number;
  chargePkr: number;
  contributionPkr: number;
  commissionPkr: number;
};

export type StudioAttribution = {
  targetUsd: number;
  targetToDateUsd: number;
  achievedUsd: number;
  /** achieved - target to date. Positive = ahead. */
  aheadUsd: number;
  kPkrPerUsd: number;
  targetLinePkr: number;
  unflooredCommissionPkr: number;
  commissionPkr: number;
  projects: StudioAttributedProject[];
};

export function attributeStudioSettlement(s: BdSettlement): StudioAttribution {
  const projects: StudioAttributedProject[] = s.projects
    .map((p) => {
      const contribution = p.netPkr - p.remotePayoutPkr - p.directCostPkr - p.chargePkr;
      return {
        projectId: p.projectId,
        bdCommissionId: p.bdCommissionId,
        title: p.title,
        workType: p.workType,
        model: p.model,
        priceUsd: p.priceUsd,
        netPkr: Math.round(p.netPkr),
        remotePayoutPkr: Math.round(p.remotePayoutPkr),
        directCostPkr: Math.round(p.directCostPkr),
        chargePkr: Math.round(p.chargePkr),
        contributionPkr: Math.round(contribution),
        commissionPkr: Math.round(contribution * s.bdRate),
      };
    })
    .sort((a, b) => b.commissionPkr - a.commissionPkr);

  // Target progress counts STUDIO-costed sales only (a MIXED month's STAFF part has no target).
  const achievedUsd = projects
    .filter((p) => p.model === "STUDIO")
    .reduce((a, p) => a + p.priceUsd, 0);

  const unfloored = Math.round(s.profitPkr * s.bdRate);
  const projectSum = projects.reduce((a, p) => a + p.commissionPkr, 0);

  return {
    targetUsd: s.targetUsd,
    targetToDateUsd: s.targetToDateUsd,
    achievedUsd,
    aheadUsd: achievedUsd - s.targetToDateUsd,
    kPkrPerUsd: s.kPkrPerUsd,
    targetLinePkr: unfloored - projectSum,
    unflooredCommissionPkr: unfloored,
    commissionPkr: s.payoutPkr,
    projects,
  };
}
