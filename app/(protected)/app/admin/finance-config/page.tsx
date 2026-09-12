// app/(protected)/app/admin/finance-config/page.tsx
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  createMonth,
  finalizeMonth,
  updateMonth,
  updateOnsiteConstants,
  updateOnsiteOverheads,
} from "./actions";
import { UnfinalizeButton, RecalculateButton } from "./month-action-buttons";
import { getOnsiteConstants } from "@/lib/onsite-points/settings";
import {
  getOnsiteOverheadSettings,
  sellableHoursPerMonth,
} from "@/lib/onsite-points/overhead-settings";

const prisma = getPrisma();

function requireSuperAdmin(role?: string) {
  if (role !== "SUPER_ADMIN") redirect("/app?err=forbidden");
}

function safeStr(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function fmtFx(v: any) {
  if (v == null) return "";
  try {
    const n = typeof v === "string" ? Number(v) : Number(v.toString?.() ?? v);
    if (Number.isFinite(n)) return n.toFixed(4);
  } catch {}
  return safeStr(v);
}

function nowMonthKeyUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default async function FinanceConfigPage({
  searchParams,
}: {
  searchParams: { monthKey?: string; err?: string; ok?: string; msg?: string };
}) {
  const { user } = await readSession();
  requireSuperAdmin(user?.role);

  const all = await prisma.monthlyFinanceConfig.findMany({
    orderBy: { monthKey: "desc" },
  });

  const onsiteConstants = await getOnsiteConstants();
  const overhead = await getOnsiteOverheadSettings();
  const sellableHours = sellableHoursPerMonth(overhead);

  const selected = searchParams.monthKey ?? all[0]?.monthKey ?? nowMonthKeyUTC();
  const row = all.find((x) => x.monthKey === selected) ?? null;

  const err = searchParams.err ? decodeURIComponent(searchParams.err) : null;
  // Custom msg takes priority; fallback to generic "Saved."
  const okMsg = searchParams.ok
    ? searchParams.msg
      ? decodeURIComponent(searchParams.msg)
      : "Saved."
    : null;

  const isFinalized = !!row?.finalizedAt;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Monthly Finance Config</h1>
        <p className="text-sm text-muted-foreground">
          Create a month, edit values, then finalize to lock server-side.
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      ) : null}

      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {okMsg}
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left: month list + create */}
        <div className="rounded-2xl border bg-card p-4 space-y-4">
          <div className="text-sm font-medium">Months</div>

          <form action={createMonth} className="space-y-2">
            <label className="block text-xs text-muted-foreground">Create / open month (YYYY-MM)</label>
            <div className="flex gap-2">
              <input
                name="monthKey"
                defaultValue={selected}
                placeholder="YYYY-MM"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              />
              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-muted">
                Open
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Tip: Create the month first, then edit values, then finalize.
            </div>
          </form>

          <div className="h-px bg-border" />

          <div className="space-y-1 max-h-[420px] overflow-auto pr-1">
            {all.length === 0 ? (
              <div className="text-sm text-muted-foreground">No months yet.</div>
            ) : (
              all.map((m) => {
                const active = m.monthKey === selected;
                const locked = !!m.finalizedAt;
                return (
                  <a
                    key={m.monthKey}
                    href={`/app/admin/finance-config?monthKey=${encodeURIComponent(m.monthKey)}`}
                    className={[
                      "flex items-center justify-between rounded-xl border px-3 py-2 text-sm",
                      active ? "bg-muted" : "hover:bg-muted/60",
                    ].join(" ")}
                  >
                    <span className="font-medium">{m.monthKey}</span>
                    <span className={locked ? "text-xs text-emerald-700" : "text-xs text-muted-foreground"}>
                      {locked ? "Locked" : "Editable"}
                    </span>
                  </a>
                );
              })
            )}
          </div>
        </div>

        {/* Right: editor */}
        <div className="md:col-span-2 rounded-2xl border bg-card p-4 space-y-4">
          {/* Header row: title + action buttons */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Selected month</div>
              <div className="text-lg font-semibold">{selected}</div>
              <div className="text-xs text-muted-foreground">
                Status:{" "}
                {isFinalized ? (
                  <span className="text-emerald-700">Finalized (locked)</span>
                ) : (
                  <span>Draft (editable)</span>
                )}
              </div>
            </div>

            {row && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* Finalize — only when not yet locked */}
                {!isFinalized && (
                  <form action={finalizeMonth}>
                    <input type="hidden" name="monthKey" value={selected} />
                    <button className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm hover:bg-primary/90 transition-colors">
                      Finalize (Lock)
                    </button>
                  </form>
                )}

                {/* Unfinalize — only when locked */}
                {isFinalized && <UnfinalizeButton monthKey={selected} />}

                {/* Recalculate — always available when row exists */}
                <RecalculateButton monthKey={selected} />
              </div>
            )}
          </div>

          {/* ── Finalized banner ── */}
          {isFinalized && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
              <div className="font-medium">This month is finalized.</div>
              <div>
                To correct values: click <strong>Unfinalize (Unlock)</strong> → edit → save →
                click <strong>Recalculate</strong> to push updated figures to all BD commission
                rows → re-<strong>Finalize</strong>.
              </div>
            </div>
          )}

          {!row ? (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              This month doesn&apos;t exist yet. Use "Create / open month" to create it.
            </div>
          ) : (
            <form action={updateMonth} className="space-y-4">
              <input type="hidden" name="monthKey" value={selected} />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">FX Rate (USD → PKR)</label>
                  <input
                    name="fxRate"
                    defaultValue={fmtFx(row.fxRate)}
                    disabled={isFinalized}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="e.g. 280.0000"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Avg Onsite Hour Cost (PKR)</label>
                  <input
                    name="avgOnsiteHourCostPkr"
                    defaultValue={row.avgOnsiteHourCostPkr ?? ""}
                    disabled={isFinalized}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="e.g. 1500"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">Remote Overhead Fixed (PKR)</label>
                  <input
                    name="remoteOverheadFixedPkr"
                    defaultValue={row.remoteOverheadFixedPkr ?? ""}
                    disabled={isFinalized}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="e.g. 250000"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">Notes</label>
                  <textarea
                    name="notes"
                    defaultValue={safeStr(row.notes ?? "")}
                    disabled={isFinalized}
                    className="min-h-[90px] w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="Optional notes..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {isFinalized
                    ? "Unlock the month to edit values."
                    : "Edits allowed until finalized."}
                </div>

                <button
                  disabled={isFinalized}
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* ── Global onsite-points constants (not per-month) ── */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">Onsite Points Constants (Global)</div>
          <p className="text-xs text-muted-foreground">
            These are not tied to a month. They drive the animator / video
            calculators and the automatic estimated-points shown on active
            projects. Changes apply <strong>going forward only</strong> —
            projects already in progress keep the values they were assigned with.
          </p>
        </div>

        <form action={updateOnsiteConstants} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Production Multiple</label>
              <input
                name="productionMultiple"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={onsiteConstants.productionMultiple}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 3"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                How many times a worker&apos;s raw hourly cost a project must
                bill to be worth doing. <strong>3 = a project must earn 3× what
                the worker costs you.</strong> This turns a cost-hour into a
                billable price. Lower it → projects count for fewer points; raise
                it → more points. Based on 8 years of animation data. Used by: the
                calculators, estimated points on active projects, and monthly
                target-point math. Changes apply going forward only.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Dollars Per Point (USD)</label>
              <input
                name="dollarsPerPoint"
                type="number"
                step="1"
                min="1"
                defaultValue={onsiteConstants.dollarsPerPoint}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 6"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The revenue value of one point: <strong>1 point = $6 of billable
                project value.</strong> Converts a project&apos;s billable price
                into points. Lower it → the same project is worth more points;
                raise it → fewer. Used by: the calculators, estimated points, and
                monthly target points. Changes apply going forward only and
                rescale all future point numbers — change with care.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Saving updates both values together, everywhere they&apos;re used.
            </div>
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-muted">
              Save constants
            </button>
          </div>
        </form>
      </div>

      {/* ── Onsite hourly rate model (global) ── */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">Onsite Hourly Rate Model (Global)</div>
          <p className="text-xs text-muted-foreground">
            Every onsite worker&apos;s hour rate is built from these four
            numbers. The department overhead is the share of rent, electricity,
            internet, management, subscriptions and ads carried by one hour of
            that department&apos;s time.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/40 p-3 space-y-1">
          <div className="text-xs font-medium">The formula</div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <code>
              onsiteHourRatePkr = (monthly salary &divide; sellable hours) +
              department overhead
            </code>
            <br />
            <code>
              sellable hours = {overhead.workingDaysPerMonth} working days
              &times; {overhead.effectiveHoursPerDay} effective hours ={" "}
              <strong>{sellableHours}</strong>
            </code>
            <br />
            Reversed, so the BD department cost base can recover the bare
            salary:{" "}
            <code>
              monthly salary = (rate &minus; department overhead) &times;{" "}
              {sellableHours}
            </code>
            <br />
            <span className="text-foreground">
              Example: an animator on 70,000 &rarr; (70,000 &divide;{" "}
              {sellableHours}) + {overhead.animationPkrPerHour} ={" "}
              <strong>
                {Math.round(70000 / sellableHours + overhead.animationPkrPerHour)}{" "}
                PKR/hour
              </strong>
              . A video editor on the same salary &rarr;{" "}
              <strong>
                {Math.round(
                  70000 / sellableHours + overhead.videoEditingPkrPerHour
                )}{" "}
                PKR/hour
              </strong>
              .
            </span>
          </p>
        </div>

        <form action={updateOnsiteOverheads} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                Animation overhead (PKR / hour)
              </label>
              <input
                name="animationPkrPerHour"
                type="number"
                step="1"
                min="0"
                defaultValue={overhead.animationPkrPerHour}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 322"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Added to every <strong>ONSITE_ANIMATOR</strong> rate.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">
                Video Editing overhead (PKR / hour)
              </label>
              <input
                name="videoEditingPkrPerHour"
                type="number"
                step="1"
                min="0"
                defaultValue={overhead.videoEditingPkrPerHour}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 219"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Added to every other onsite worker&apos;s rate.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Working days / month</label>
              <input
                name="workingDaysPerMonth"
                type="number"
                step="1"
                min="1"
                max="31"
                defaultValue={overhead.workingDaysPerMonth}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 25"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">
                Effective hours / day
              </label>
              <input
                name="effectiveHoursPerDay"
                type="number"
                step="0.1"
                min="0.1"
                max="24"
                defaultValue={overhead.effectiveHoursPerDay}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 6.5"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Keep this equal to the effective hours used by the points model,
                or costing and performance will disagree about a full month.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">
                Saving does not rewrite existing worker rates.
              </strong>{" "}
              Rates are stored per worker. If you change the overhead or the
              divisor, every stored rate now implies a different salary — open
              each onsite worker&apos;s edit page and re-enter the rate. The
              implied-salary readout there will tell you which ones are stale.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Sellable hours per month: <strong>{sellableHours}</strong>
            </div>
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-muted">
              Save rate model
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}