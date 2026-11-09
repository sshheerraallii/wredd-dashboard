// STUDIO / MIXED settlement card. Same rules as the STAFF card: a BD sees their
// commission, target progress and per-project lines (which add up exactly to the
// commission); admins also see revenue, costs, rate and the expense rate.
import Link from "next/link";
import type { BdSettlement, SettlementRun } from "@/lib/bd-settlement/compute";
import type { StudioAttribution } from "@/lib/bd-settlement/attribution-studio";

export type StudioPipelineRow = { id: string; title: string; status: string; usd: number };

const STATUS_LABEL: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  IN_PROGRESS: "In progress",
  DELIVERED: "Delivered",
  REVISION: "Revision",
};

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-PK");
}

function usd(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function signed(n: number) {
  const r = Math.round(n);
  if (r > 0) return `+${fmt(r)}`;
  if (r < 0) return `−${fmt(Math.abs(r))}`;
  return "0";
}

export function StudioSettlementCard({
  s,
  run,
  a,
  pipeline,
  isAdmin,
  monthKey,
}: {
  s: BdSettlement;
  run: SettlementRun;
  a: StudioAttribution;
  pipeline: StudioPipelineRow[];
  isAdmin: boolean;
  monthKey: string;
}) {
  const target = a.targetUsd;
  const soldPct = target > 0 ? Math.round((a.achievedUsd / target) * 100) : 0;
  const pacePct = target > 0 ? Math.round((a.targetToDateUsd / target) * 100) : 0;
  const ahead = a.aheadUsd >= 0;
  const gapUsd = Math.abs(a.aheadUsd);
  const pipelineUsd = pipeline.reduce((x, p) => x + p.usd, 0);
  const projectedPct = target > 0 ? Math.round(((a.achievedUsd + pipelineUsd) / target) * 100) : 0;
  const topId =
    a.projects.length > 0 && a.projects[0].commissionPkr > 0 ? a.projects[0].projectId : null;
  const cols = isAdmin ? 8 : 3;

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {isAdmin ? (
          <Link href={`/app/bd/settlement?month=${monthKey}&bd=${s.bdId}`} className="text-sm font-medium underline">
            {s.bdName}
          </Link>
        ) : (
          <div className="text-sm font-medium">{s.bdName}</div>
        )}
        {isAdmin ? (
          <div className="text-xs text-muted-foreground">
            {s.model} &middot; Rate {(s.bdRate * 100).toFixed(2)}% &middot; {fmt(a.kPkrPerUsd)} PKR expense per
            target $
          </div>
        ) : null}
      </div>

      {/* ── Commission ── */}
      <div className="rounded-xl bg-muted/60 px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {run.isCurrentMonth ? "Your commission so far" : "Your commission"}
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">
          {fmt(a.commissionPkr)} <span className="text-base font-medium">PKR</span>
        </div>
        {a.unflooredCommissionPkr < 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            The month is below zero ({signed(a.unflooredCommissionPkr)}), so commission is 0. Negative months are
            never carried forward.
          </p>
        ) : null}
      </div>

      {/* ── Target ── */}
      <div className="rounded-xl border bg-background p-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Target</span>
          <span className="text-sm tabular-nums">
            {target > 0 ? `${usd(a.achievedUsd)} sold of ${usd(target)} (${soldPct}%)` : "No target set"}
          </span>
        </div>
        {target > 0 ? (
          <>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${a.achievedUsd >= target ? "bg-emerald-600" : "bg-primary"}`}
                style={{ width: `${Math.min(100, Math.max(0, soldPct))}%` }}
              />
              {run.isCurrentMonth ? (
                <div
                  className="absolute top-0 h-full w-0.5 bg-foreground"
                  style={{ left: `${Math.min(100, Math.max(0, pacePct))}%` }}
                  title="Where you should be today"
                />
              ) : null}
            </div>
            <p className={`text-xs ${gapUsd < 1 ? "text-muted-foreground" : ahead ? "text-emerald-600" : "text-red-600"}`}>
              {run.isCurrentMonth
                ? gapUsd < 1
                  ? "Exactly on pace for today."
                  : ahead
                  ? `${usd(gapUsd)} ahead of pace for today (${usd(a.targetToDateUsd)}).`
                  : `${usd(gapUsd)} behind pace for today (${usd(a.targetToDateUsd)}).`
                : a.achievedUsd >= target
                ? `Target hit${a.achievedUsd > target ? ` — ${usd(a.achievedUsd - target)} over` : ""}.`
                : `${usd(target - a.achievedUsd)} short of target.`}
            </p>
            {run.isCurrentMonth && pipeline.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                With your {pipeline.length} open project(s) completed, you&apos;d be at{" "}
                {usd(a.achievedUsd + pipelineUsd)} ({projectedPct}%).
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ── Projects (lines add up to the commission) ── */}
      <div className="rounded-xl border bg-background overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2 font-medium">Completed project</th>
              <th className="p-2 font-medium text-right">Sold</th>
              {isAdmin ? (
                <>
                  <th className="p-2 font-medium text-right">Net</th>
                  <th className="p-2 font-medium text-right">Remote</th>
                  <th className="p-2 font-medium text-right">Direct</th>
                  <th className="p-2 font-medium text-right">Expense</th>
                  <th className="p-2 font-medium text-right">Contribution</th>
                </>
              ) : null}
              <th className="p-2 font-medium text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {a.projects.length === 0 ? (
              <tr className="border-t">
                <td className="p-2 text-muted-foreground" colSpan={cols}>
                  No projects completed this month yet.
                </td>
              </tr>
            ) : (
              a.projects.map((p) => (
                <tr key={p.projectId} className="border-t">
                  <td className="p-2">
                    <Link className="underline" href={`/app/projects/${p.projectId}`}>
                      {p.title}
                    </Link>
                    {p.projectId === topId ? (
                      <span className="ml-2 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        Top earner
                      </span>
                    ) : null}
                    {isAdmin && s.model === "MIXED" ? (
                      <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {p.model}
                      </span>
                    ) : null}
                    {p.commissionPkr < 0 ? (
                      <div className="text-[11px] text-red-600">Cost more than it earned.</div>
                    ) : null}
                  </td>
                  <td className="p-2 text-right tabular-nums">{usd(p.priceUsd)}</td>
                  {isAdmin ? (
                    <>
                      <td className="p-2 text-right tabular-nums">{fmt(p.netPkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.remotePayoutPkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.directCostPkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.chargePkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.contributionPkr)}</td>
                    </>
                  ) : null}
                  <td className={`p-2 text-right tabular-nums ${p.commissionPkr < 0 ? "text-red-600" : ""}`}>
                    {signed(p.commissionPkr)}
                  </td>
                </tr>
              ))
            )}

            <tr className="border-t bg-muted/20">
              <td className="p-2" colSpan={cols - 1}>
                {a.targetLinePkr < 0 ? "Unsold target" : "Over-target credit"}
                {target > 0 ? ` (${usd(gapUsd)} ${ahead ? "ahead" : "behind"})` : ""}
                <div className="text-[11px] text-muted-foreground">
                  {a.targetLinePkr < 0
                    ? "Your share of the month's expenses on the part of your target not sold yet."
                    : "Sales beyond your target carry no extra expense."}
                  {s.model === "MIXED" ? " Includes unused capacity from the STAFF part of the month." : ""}
                </div>
              </td>
              <td
                className={`p-2 text-right tabular-nums ${a.targetLinePkr < 0 ? "text-red-600" : "text-emerald-600"}`}
              >
                {signed(a.targetLinePkr)}
              </td>
            </tr>

            <tr className="border-t font-semibold">
              <td className="p-2" colSpan={cols - 1}>
                Total
              </td>
              <td className="p-2 text-right tabular-nums">
                {a.unflooredCommissionPkr < 0 ? (
                  <>
                    <span className="text-red-600">{signed(a.unflooredCommissionPkr)}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">payable 0</span>
                  </>
                ) : (
                  fmt(a.unflooredCommissionPkr)
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {s.excludedPaidCount > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {s.excludedPaidCount} project(s) already paid under the old per-project system are not counted here.
        </p>
      ) : null}

      {/* ── Pipeline ── */}
      {run.isCurrentMonth && pipeline.length > 0 ? (
        <details className="rounded-xl border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Open projects ({pipeline.length}) &mdash; count once completed
          </summary>
          <div className="mt-2 space-y-1">
            {pipeline.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-2 text-xs">
                <Link className="underline" href={`/app/projects/${p.id}`}>
                  {p.title}
                </Link>
                <span className="text-muted-foreground tabular-nums">
                  {STATUS_LABEL[p.status] ?? p.status} &middot; {usd(p.usd)}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* ── Admin-only breakdown ── */}
      {isAdmin ? (
        <details className="rounded-xl border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">Breakdown (admin only)</summary>
          <div className="mt-3 space-y-2">
            <Row label="Revenue delivered (net)" value={fmt(s.revenuePkr)} />
            <Row label="Remote worker payouts" value={`− ${fmt(s.remotePayoutPkr)}`} />
            <Row label="Direct project costs" value={`− ${fmt(s.directCostPkr)}`} />
            <Row
              label="Expense share"
              value={`− ${fmt(s.expenseSharePkr)}`}
              detail={`target ${usd(a.targetUsd)} × ${fmt(a.kPkrPerUsd)} PKR/$ = ${fmt(s.expenseShareFullPkr)}${
                run.isCurrentMonth ? ` — charged at ${run.prorationPct}% so far` : ""
              }`}
            />
            {s.model === "MIXED" ? (
              <Row
                label="STAFF cost base (part of month)"
                value={`− ${fmt(s.costBasePkr - s.expenseSharePkr)}`}
              />
            ) : null}
            <div className="flex items-baseline justify-between border-t pt-2">
              <span className="text-sm font-medium">Profit</span>
              <span className={`text-sm font-semibold ${s.profitPkr < 0 ? "text-red-600" : ""}`}>{fmt(s.profitPkr)}</span>
            </div>
            {run.studio ? (
              <p className="pt-1 text-[11px] text-muted-foreground">
                Month expenses {fmt(run.studio.expensesPkr)} PKR &divide; all targets {usd(run.studio.totalTargetUsd)} ={" "}
                {fmt(run.studio.kPkrPerUsd)} PKR per target $.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <div className="text-sm">{label}</div>
        {detail ? <div className="text-[11px] text-muted-foreground">{detail}</div> : null}
      </div>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  );
}
