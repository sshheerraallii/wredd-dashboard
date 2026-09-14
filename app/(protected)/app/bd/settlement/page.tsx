// app/(protected)/app/bd/settlement/page.tsx
//
// Monthly settlement, BD-facing. Deliberately shows four lines — revenue,
// remote payouts, cost base, profit — and shows hours as CAPACITY USED rather
// than as a cost line. Presenting hours as a cost here would re-teach the old
// per-project model the absorption change was meant to replace.

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { computeBdSettlements } from "@/lib/bd-settlement/compute";

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-PK");
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function BdSettlementPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = String(session.user.role ?? "");
  const isAdmin = role === "SUPER_ADMIN" || role === "MANAGER";
  const isBd = role === "BUSINESS_DEVELOPER" || role === "BD";
  if (!isAdmin && !isBd) redirect("/app/projects?err=forbidden");

  const sp = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const monthKey = /^\d{4}-\d{2}$/.test(sp("month") ?? "")
    ? (sp("month") as string)
    : currentMonthKey();

  // A BD only ever sees themselves. Admins may pass ?bd=<id>.
  const viewBdId = isAdmin ? sp("bd") ?? null : session.user.id;

  let run: Awaited<ReturnType<typeof computeBdSettlements>> | null = null;
  let error: string | null = null;
  try {
    run = await computeBdSettlements(monthKey);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not compute settlement.";
  }

  const mine = run?.settlements.find((s) =>
    viewBdId ? s.bdId === viewBdId : false
  );
  const visible = isAdmin && !viewBdId ? run?.settlements ?? [] : mine ? [mine] : [];

  const prev = (() => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const next = (() => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  const qs = (mk: string) =>
    `/app/bd/settlement?month=${mk}${viewBdId ? `&bd=${viewBdId}` : ""}`;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Monthly settlement</h1>
          <p className="text-sm text-muted-foreground">{monthKey}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={qs(prev)} className="rounded-xl border px-3 py-1.5 hover:bg-muted">
            &larr; {prev}
          </Link>
          <Link href={qs(next)} className="rounded-xl border px-3 py-1.5 hover:bg-muted">
            {next} &rarr;
          </Link>
          <Link
            href="/app/bd/commission"
            className="rounded-xl border px-3 py-1.5 hover:bg-muted"
          >
            Project ledger
          </Link>
        </div>
      </div>

      {/* ── How this works ── */}
      <div className="rounded-2xl border bg-muted/40 p-4 space-y-2">
        <div className="text-sm font-medium">How your commission is calculated</div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Each month you carry a share of the studio&apos;s running cost &mdash;
          the salaries of the team producing your work, plus that team&apos;s
          share of rent, power, internet, software and ads. Your share is set by
          your department allocation and is <strong>fixed for the month</strong>.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">
            Profit = revenue delivered &minus; remote payouts &minus; your cost
            base.
          </strong>{" "}
          You earn your percentage of that profit.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your cost base does not change with how busy the team is. If the floor
          is full, every extra rupee of revenue is nearly all profit. If it is
          quiet, you are still paying for it. Keeping work in the pipeline is the
          whole job.
        </p>
      </div>

      {run?.isCurrentMonth ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Month in progress.</strong>{" "}
            {run.elapsedWorkDays} of {run.workDaysInMonth} working days elapsed,
            so your cost base below is charged at {run.prorationPct}% to match
            the revenue booked so far. At month end it settles at the full
            amount.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
          <div className="text-sm font-medium">Settlement unavailable</div>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {run && run.warnings.length > 0 && isAdmin ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-1">
          <div className="text-sm font-medium">Warnings</div>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {run.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {visible.length === 0 && !error ? (
        <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
          No settlement for {monthKey}.
          {isAdmin
            ? " Check that department allocations exist for this month."
            : ""}
        </div>
      ) : null}

      {visible.map((s) => {
        const used =
          s.capacityHours > 0
            ? Math.round((s.usedHours / s.capacityHours) * 100)
            : 0;

        return (
          <div key={s.bdId} className="rounded-2xl border bg-card p-4 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium">{s.bdName}</div>
              <div className="text-xs text-muted-foreground">
                Commission rate {(s.bdRate * 100).toFixed(2)}%
              </div>
            </div>

            {/* The four lines */}
            <div className="space-y-2">
              <Row label="Revenue delivered" value={fmt(s.revenuePkr)} />
              <Row
                label="Remote worker payouts"
                value={`\u2212 ${fmt(s.remotePayoutPkr)}`}
              />
              <Row
                label="Your cost base"
                value={`\u2212 ${fmt(s.costBasePkr)}`}
                detail={
                  run?.isCurrentMonth
                    ? `salaries ${fmt(s.costSalariesPkr)} + overhead ${fmt(
                        s.costOverheadPkr
                      )} \u2014 ${run.prorationPct}% of the month's ${fmt(
                        s.costBaseFullPkr
                      )}`
                    : `salaries ${fmt(s.costSalariesPkr)} + overhead ${fmt(
                        s.costOverheadPkr
                      )}`
                }
              />
              <div className="flex items-baseline justify-between border-t pt-2">
                <span className="text-sm font-medium">Profit</span>
                <span
                  className={`text-sm font-semibold ${
                    s.profitPkr < 0 ? "text-red-600" : ""
                  }`}
                >
                  {fmt(s.profitPkr)}
                </span>
              </div>
              <div className="flex items-baseline justify-between rounded-xl bg-muted/60 px-3 py-2">
                <span className="text-sm font-medium">
                  Your commission ({(s.bdRate * 100).toFixed(0)}%)
                </span>
                <span className="text-base font-semibold">
                  {fmt(s.payoutPkr)} PKR
                </span>
              </div>
              {s.profitPkr < 0 ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Profit is negative this month, so commission is zero. Negative
                  months are never carried forward into the next month.
                </p>
              ) : null}
            </div>

            {/* Cost base breakdown */}
            <details className="rounded-xl border bg-background p-3">
              <summary className="cursor-pointer text-xs font-medium">
                What makes up your cost base
              </summary>
              <div className="mt-2 space-y-1">
                {s.allocations.map((a) => (
                  <div
                    key={a.departmentId}
                    className="flex items-baseline justify-between text-[11px]"
                  >
                    <span className="text-muted-foreground">
                      {a.name} &mdash; {a.sharePercent}% of the department
                    </span>
                    <span>{fmt(a.chargedPkr)}</span>
                  </div>
                ))}
                <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Each department&apos;s cost is its team&apos;s salaries plus
                  its share of the studio overhead, divided by how much of the
                  floor it occupies. You are charged your allocated percentage of
                  that total.
                </p>
              </div>
            </details>

            {/* Capacity used — NOT a cost line */}
            <div className="rounded-xl border bg-background p-3 space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium">Capacity used</span>
                <span className="text-xs">
                  {Math.round(s.usedHours).toLocaleString()} of{" "}
                  {Math.round(s.capacityHours).toLocaleString()} hours ({used}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, used))}%` }}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Hours are not a charge &mdash; you have already paid for this
                capacity through your cost base. This is how much of it your work
                actually used.
              </p>
            </div>

            <div className="text-[11px] text-muted-foreground">
              {s.projectCount} project(s) counted.
              {s.excludedPaidCount > 0
                ? ` ${s.excludedPaidCount} already-paid project(s) excluded — settled payouts never re-enter this calculation.`
                : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <div className="text-sm">{label}</div>
        {detail ? (
          <div className="text-[11px] text-muted-foreground">{detail}</div>
        ) : null}
      </div>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  );
}
