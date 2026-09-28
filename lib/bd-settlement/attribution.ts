import type { BdSettlement, SettlementRun } from "./compute";

/**
 * Splits a BD's monthly settlement into per-project commission lines that ADD
 * UP to the settlement exactly.
 *
 *   bdHourRate    = costBaseFull / capacityHours   (the BD's OWN department
 *                   share per sellable hour — NOT the studio blended rate,
 *                   which would never sum to this BD's settlement)
 *   per project   = (net - remote payout - hours x bdHourRate) x rate
 *   unused line   = settlement commission (unfloored) - sum of project lines
 *
 * Algebraically the unused line equals
 *   -(capacityToDate - usedHours) x bdHourRate x rate
 * i.e. the commission lost to unsold floor time. It is computed as the residual
 * so rounding can never make the lines disagree with the total. Mid-month it
 * can be positive: the BD is ahead of pace.
 *
 * The month-level floor (negative months pay 0) is applied only to the total.
 */

export type AttributedProject = {
  projectId: string;
  bdCommissionId: string;
  allocatedHours: number;
  overridden: boolean;
  overrideNote: string | null;
  title: string;
  workType: string;
  hours: number;
  netPkr: number;
  remotePayoutPkr: number;
  hourCostPkr: number;
  contributionPkr: number;
  commissionPkr: number;
};

export type Attribution = {
  bdHourRatePkr: number;
  capacityHours: number;
  capacityToDateHours: number;
  usedHours: number;
  /** capacityToDate - used. Negative = ahead of pace. */
  unusedHours: number;
  unusedCommissionPkr: number;
  /** Sum of project lines + unused line. Equals round(profit x rate). */
  unflooredCommissionPkr: number;
  /** What is actually payable: max(0, unfloored). Equals settlement.payoutPkr. */
  commissionPkr: number;
  projects: AttributedProject[];
};

export function attributeSettlement(
  s: BdSettlement,
  run: Pick<SettlementRun, "prorationPct">
): Attribution {
  const bdHourRate = s.capacityHours > 0 ? s.costBaseFullPkr / s.capacityHours : 0;
  const proration = Math.min(1, Math.max(0, run.prorationPct / 100));
  const capacityToDate = s.capacityHours * proration;

  const projects: AttributedProject[] = s.projects
    .map((p) => {
      const hourCost = p.hours * bdHourRate;
      const contribution = p.netPkr - p.remotePayoutPkr - hourCost;
      return {
        projectId: p.projectId,
        bdCommissionId: p.bdCommissionId,
        allocatedHours: p.allocatedHours,
        overridden: p.overridden,
        overrideNote: p.overrideNote,
        title: p.title,
        workType: p.workType,
        hours: p.hours,
        netPkr: Math.round(p.netPkr),
        remotePayoutPkr: Math.round(p.remotePayoutPkr),
        hourCostPkr: Math.round(hourCost),
        contributionPkr: Math.round(contribution),
        commissionPkr: Math.round(contribution * s.bdRate),
      };
    })
    .sort((a, b) => b.commissionPkr - a.commissionPkr);

  const unfloored = Math.round(s.profitPkr * s.bdRate);
  const projectSum = projects.reduce((a, p) => a + p.commissionPkr, 0);

  return {
    bdHourRatePkr: Math.round(bdHourRate),
    capacityHours: s.capacityHours,
    capacityToDateHours: Number(capacityToDate.toFixed(1)),
    usedHours: s.usedHours,
    unusedHours: Number((capacityToDate - s.usedHours).toFixed(1)),
    unusedCommissionPkr: unfloored - projectSum,
    unflooredCommissionPkr: unfloored,
    commissionPkr: s.payoutPkr,
    projects,
  };
}
