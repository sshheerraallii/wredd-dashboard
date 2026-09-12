"use client";

import { useState } from "react";

type Props = {
  defaultRate: number | null;
  workerType: string | null;
  overheadPkrPerHour: number;
  sellableHours: number;
  workingDays: number;
  effectiveHours: number;
};

function fmt(n: number) {
  return n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

/**
 * Renders the onsiteHourRatePkr input plus a live two-way helper:
 *   - type a monthly salary -> see the rate to enter
 *   - the rate currently in the box -> see the salary it implies
 *
 * The implied salary is what the BD department cost base will read back, so if
 * it does not match the salary sheet, the rate is wrong.
 */
export function OnsiteRateField({
  defaultRate,
  workerType,
  overheadPkrPerHour,
  sellableHours,
  workingDays,
  effectiveHours,
}: Props) {
  const [rate, setRate] = useState<string>(
    defaultRate == null ? "" : String(defaultRate)
  );
  const [salary, setSalary] = useState<string>("");

  const deptLabel =
    workerType === "ONSITE_ANIMATOR" ? "Animation" : "Video Editing";

  const salaryNum = Number(salary);
  const suggestedRate =
    Number.isFinite(salaryNum) && salaryNum > 0
      ? Math.round(salaryNum / sellableHours + overheadPkrPerHour)
      : null;

  const rateNum = Number(rate);
  const impliedSalary =
    Number.isFinite(rateNum) && rateNum > overheadPkrPerHour
      ? Math.round((rateNum - overheadPkrPerHour) * sellableHours)
      : null;

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">Onsite hour rate (PKR)</label>
      <input
        name="onsiteHourRatePkr"
        type="number"
        min={0}
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        placeholder="Leave blank to use global avg rate"
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      />
      <div className="text-xs text-muted-foreground">
        Per-hour cost used in BD commission overhead. Falls back to monthly avg
        if blank.
      </div>

      <div className="mt-2 rounded-xl border bg-muted/40 p-3 space-y-2">
        <div className="text-xs font-medium">How this rate is built</div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <code>
            rate = (monthly salary &divide; {sellableHours}) +{" "}
            {fmt(overheadPkrPerHour)}
          </code>
          <br />
          {sellableHours} sellable hours = {workingDays} working days &times;{" "}
          {effectiveHours} effective hours. {fmt(overheadPkrPerHour)} PKR/hour is
          the <strong>{deptLabel}</strong> overhead share (rent, electricity,
          internet, management, subscriptions, ads). Change those four values in{" "}
          <strong>Finance Config &rarr; Onsite Hourly Rate Model</strong>.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium">
              Monthly salary (PKR)
            </label>
            <input
              type="number"
              min={0}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="e.g. 70000"
              className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
            />
          </div>
          {suggestedRate != null ? (
            <div className="flex items-center gap-2 pb-1">
              <span className="text-[11px] text-muted-foreground">
                &rarr; rate <strong>{fmt(suggestedRate)}</strong>
              </span>
              <button
                type="button"
                onClick={() => setRate(String(suggestedRate))}
                className="rounded-lg border px-2 py-1 text-[11px] hover:bg-muted"
              >
                Use this
              </button>
            </div>
          ) : null}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {impliedSalary != null ? (
            <>
              The rate in the box implies a monthly salary of{" "}
              <strong>{fmt(impliedSalary)} PKR</strong>. If that is not what this
              person is actually paid, the rate is stale &mdash; the BD
              department cost base reads the salary back out of it.
            </>
          ) : (
            <>
              Enter a rate above {fmt(overheadPkrPerHour)} to see the monthly
              salary it implies.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
