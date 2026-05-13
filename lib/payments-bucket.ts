// lib/payments-bucket.ts
export type Bucket = "ACTIVE" | "CLEARING" | "DUE" | "HISTORY";
export type BucketOrHide = Bucket | "HIDE";

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Policy:
 * - VOIDED => HIDE
 * - PAID / EXCEPTION_PAID => HISTORY
 * - UNPAID + project not completed => ACTIVE
 * - Otherwise => CLEARING until 1st of payable month, then DUE
 *
 * payableOn stays as the true pay date (e.g., 10th), only bucketing changes.
 */
export function bucketPaymentLine(args: {
  projectStatus: string | null | undefined;
  lineStatus: string;
  payableOn: Date;
  now: Date;
}): BucketOrHide {
  const { projectStatus, lineStatus, payableOn, now } = args;

  if (lineStatus === "VOIDED") return "HIDE";
  if (lineStatus === "PAID" || lineStatus === "EXCEPTION_PAID") return "HISTORY";

  // If linked to a project and not completed, it’s active work.
  if (projectStatus && projectStatus !== "COMPLETED") return "ACTIVE";

  // Manual entries OR completed projects:
  // Move to DUE on the 1st of the payable month.
  const dueMarker = startOfMonth(new Date(payableOn));
  return now >= dueMarker ? "DUE" : "CLEARING";
}
