// app/(protected)/app/bd/settlement/page.tsx
//
// Monthly settlement.
//
// BD view: commission, capacity used against pace, and a per-project list whose
// lines add up exactly to the commission. No revenue, cost base, profit, rate
// or formula is shown to a BD.
//
// Admin view: the same, plus the full breakdown (revenue, remote payouts, cost
// base, profit, rate, department allocation, per-project hour cost).

export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  computeBdSettlements,
  type BdSettlement,
  type SettlementRun,
} from "@/lib/bd-settlement/compute";
import {
  attributeSettlement,
  type Attribution,
} from "@/lib/bd-settlement/attribution";

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-PK");
}

function signed(n: number) {
  const r = Math.round(n);
  if (r > 0) return `+${fmt(r)}`;
  if (r < 0) return `\u2212${fmt(Math.abs(r))}`;
  return "0";
}

function hrs(n: number) {
  return Math.round(n).toLocaleString("en-PK");
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(monthKey: string, delta: number) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type PipelineRow = { id: string; title: string; status: string; hours: number };

const STATUS_LABEL: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  IN_PROGRESS: "In progress",
  DELIVERED: "Delivered",
  REVISION: "Revision",
};

export default async function BdSettlementPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = String(session.user.role ?? "");
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdmin = isSuperAdmin || role === "MANAGER";
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

  let run: SettlementRun | null = null;
  let error: string | null = null;
  try {
    run = await computeBdSettlements(monthKey);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not compute settlement.";
  }

  const visible: BdSettlement[] = !run
    ? []
    : viewBdId
    ? run.settlements.filter((s) => s.bdId === viewBdId)
    : isAdmin
    ? run.settlements
    : [];

  // Pipeline: this BD's projects not yet first-completed. Hours only, no money.
  // Shown for the current month only — it is a forward look, not history.
  const pipelineByBd = new Map<string, PipelineRow[]>();
  if (run?.isCurrentMonth && visible.length > 0) {
    const prisma = getPrisma();
    const open = await prisma.project.findMany({
      where: {
        bdOwnerId: { in: visible.map((s) => s.bdId) },
        firstCompletedAt: null,
        status: { notIn: ["CANCELLED", "COMPLETED"] as never },
        finance: { isNot: null },
      },
      select: {
        id: true,
        title: true,
        status: true,
        bdOwnerId: true,
        finance: { select: { workType: true, allowedHours: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    for (const p of open) {
      if (!p.bdOwnerId) continue;
      const list = pipelineByBd.get(p.bdOwnerId) ?? [];
      list.push({
        id: p.id,
        title: p.title ?? p.id,
        status: String(p.status),
        hours:
          String(p.finance?.workType) === "ONSITE"
            ? p.finance?.allowedHours ?? 0
            : 0,
      });
      pipelineByBd.set(p.bdOwnerId, list);
    }
  }

  const prev = shiftMonth(monthKey, -1);
  const next = shiftMonth(monthKey, 1);
  const qs = (mk: string) =>
    `/app/bd/settlement?month=${mk}${isAdmin && viewBdId ? `&bd=${viewBdId}` : ""}`;

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
          {isAdmin && viewBdId ? (
            <Link
              href={`/app/bd/settlement?month=${monthKey}`}
              className="rounded-xl border px-3 py-1.5 hover:bg-muted"
            >
              All BDs
            </Link>
          ) : null}
        </div>
      </div>

      {run?.isCurrentMonth ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Month in progress.</strong>{" "}
            {run.elapsedWorkDays} of {run.workDaysInMonth} working days elapsed.
            Figures update as projects complete and settle at month end.
            {isAdmin ? ` Cost base charged at ${run.prorationPct}%.` : ""}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
          <div className="text-sm font-medium">Settlement unavailable</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? error
              : "This month's settlement hasn't been set up yet. Please check back later or contact management."}
          </p>
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
          {isAdmin ? " Check that department allocations exist for this month." : ""}
        </div>
      ) : null}

      {run
        ? visible.map((s) => (
            <SettlementCard
              key={s.bdId}
              s={s}
              run={run as SettlementRun}
              a={attributeSettlement(s, run as SettlementRun)}
              pipeline={pipelineByBd.get(s.bdId) ?? []}
              isAdmin={isAdmin}
              monthKey={monthKey}
            />
          ))
        : null}
    </div>
  );
}

function SettlementCard({
  s,
  run,
  a,
  pipeline,
  isAdmin,
  monthKey,
}: {
  s: BdSettlement;
  run: SettlementRun;
  a: Attribution;
  pipeline: PipelineRow[];
  isAdmin: boolean;
  monthKey: string;
}) {
  const cap = a.capacityHours;
  const usedPct = cap > 0 ? Math.round((a.usedHours / cap) * 100) : 0;
  const pacePct = cap > 0 ? Math.round((a.capacityToDateHours / cap) * 100) : 0;
  const ahead = a.unusedHours < 0;
  const gap = Math.abs(a.unusedHours);
  const pipelineHours = pipeline.reduce((x, p) => x + p.hours, 0);
  const projectedPct =
    cap > 0 ? Math.round(((a.usedHours + pipelineHours) / cap) * 100) : 0;
  const topId =
    a.projects.length > 0 && a.projects[0].commissionPkr > 0
      ? a.projects[0].projectId
      : null;

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {isAdmin ? (
          <Link
            href={`/app/bd/settlement?month=${monthKey}&bd=${s.bdId}`}
            className="text-sm font-medium underline"
          >
            {s.bdName}
          </Link>
        ) : (
          <div className="text-sm font-medium">{s.bdName}</div>
        )}
        {isAdmin ? (
          <div className="text-xs text-muted-foreground">
            Rate {(s.bdRate * 100).toFixed(2)}% &middot; {a.bdHourRatePkr} PKR/h
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
            The month is below zero ({signed(a.unflooredCommissionPkr)}), so
            commission is 0. Negative months are never carried forward.
          </p>
        ) : null}
      </div>

      {/* ── Capacity used vs pace ── */}
      <div className="rounded-xl border bg-background p-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Capacity used</span>
          <span className="text-sm tabular-nums">
            {hrs(a.usedHours)} of {hrs(cap)} h ({usedPct}%)
          </span>
        </div>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${ahead ? "bg-emerald-600" : "bg-primary"}`}
            style={{ width: `${Math.min(100, Math.max(0, usedPct))}%` }}
          />
          {run.isCurrentMonth ? (
            <div
              className="absolute top-0 h-full w-0.5 bg-foreground"
              style={{ left: `${Math.min(100, Math.max(0, pacePct))}%` }}
              title="Where you should be today"
            />
          ) : null}
        </div>
        <p
          className={`text-xs ${
            gap < 0.5 ? "text-muted-foreground" : ahead ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {run.isCurrentMonth
            ? gap < 0.5
              ? "Exactly on pace for today."
              : ahead
              ? `${hrs(gap)} h ahead of pace for today (${hrs(a.capacityToDateHours)} h).`
              : `${hrs(gap)} h behind pace for today (${hrs(a.capacityToDateHours)} h).`
            : gap < 0.5
            ? "Capacity fully used this month."
            : ahead
            ? `${hrs(gap)} h over capacity this month.`
            : `${hrs(gap)} h of capacity went unused this month.`}
        </p>
        {run.isCurrentMonth && pipeline.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            With your {pipeline.length} open project(s) completed, you&apos;d be
            at {hrs(a.usedHours + pipelineHours)} h ({projectedPct}%).
          </p>
        ) : null}
      </div>

      {/* ── Projects (lines add up to the commission) ── */}
      <div className="rounded-xl border bg-background overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2 font-medium">Completed project</th>
              <th className="p-2 font-medium text-right">Hours</th>
              {isAdmin ? (
                <>
                  <th className="p-2 font-medium text-right">Net</th>
                  <th className="p-2 font-medium text-right">Remote</th>
                  <th className="p-2 font-medium text-right">Hour cost</th>
                  <th className="p-2 font-medium text-right">Contribution</th>
                </>
              ) : null}
              <th className="p-2 font-medium text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {a.projects.length === 0 ? (
              <tr className="border-t">
                <td className="p-2 text-muted-foreground" colSpan={isAdmin ? 7 : 3}>
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
                    {p.commissionPkr < 0 ? (
                      <div className="text-[11px] text-red-600">
                        Used more hours than it earned.
                      </div>
                    ) : null}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {p.workType === "ONSITE" ? hrs(p.hours) : "remote"}
                  </td>
                  {isAdmin ? (
                    <>
                      <td className="p-2 text-right tabular-nums">{fmt(p.netPkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.remotePayoutPkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.hourCostPkr)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(p.contributionPkr)}</td>
                    </>
                  ) : null}
                  <td
                    className={`p-2 text-right tabular-nums ${
                      p.commissionPkr < 0 ? "text-red-600" : ""
                    }`}
                  >
                    {signed(p.commissionPkr)}
                  </td>
                </tr>
              ))
            )}

            <tr className="border-t bg-muted/20">
              <td className="p-2" colSpan={isAdmin ? 6 : 2}>
                {ahead
                  ? run.isCurrentMonth
                    ? "Ahead of pace"
                    : "Over capacity"
                  : "Unused capacity"}{" "}
                ({hrs(gap)} h)
                <div className="text-[11px] text-muted-foreground">
                  {ahead
                    ? "You've used more floor time than the month so far has paid for."
                    : "Floor time you're paying for that no project used."}
                </div>
              </td>
              <td
                className={`p-2 text-right tabular-nums ${
                  a.unusedCommissionPkr < 0 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {signed(a.unusedCommissionPkr)}
              </td>
            </tr>

            <tr className="border-t font-semibold">
              <td className="p-2" colSpan={isAdmin ? 6 : 2}>
                Total
              </td>
              <td className="p-2 text-right tabular-nums">
                {a.unflooredCommissionPkr < 0 ? (
                  <>
                    <span className="text-red-600">{signed(a.unflooredCommissionPkr)}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      payable 0
                    </span>
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
          {s.excludedPaidCount} project(s) already paid under the old per-project
          system are not counted here.
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
                  {STATUS_LABEL[p.status] ?? p.status} &middot;{" "}
                  {p.hours > 0 ? `${hrs(p.hours)} h` : "remote / no hours"}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* ── Admin-only breakdown ── */}
      {isAdmin ? (
        <details className="rounded-xl border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Breakdown (admin only)
          </summary>
          <div className="mt-3 space-y-2">
            <Row label="Revenue delivered" value={fmt(s.revenuePkr)} />
            <Row label="Remote worker payouts" value={`\u2212 ${fmt(s.remotePayoutPkr)}`} />
            <Row
              label="Cost base"
              value={`\u2212 ${fmt(s.costBasePkr)}`}
              detail={`salaries ${fmt(s.costSalariesPkr)} + overhead ${fmt(s.costOverheadPkr)}${
                run.isCurrentMonth
                  ? ` \u2014 ${run.prorationPct}% of the month's ${fmt(s.costBaseFullPkr)}`
                  : ""
              }`}
            />
            <div className="flex items-baseline justify-between border-t pt-2">
              <span className="text-sm font-medium">Profit</span>
              <span className={`text-sm font-semibold ${s.profitPkr < 0 ? "text-red-600" : ""}`}>
                {fmt(s.profitPkr)}
              </span>
            </div>
            <div className="pt-2 space-y-1">
              {s.allocations.map((al) => (
                <div
                  key={al.departmentId}
                  className="flex items-baseline justify-between text-[11px]"
                >
                  <span className="text-muted-foreground">
                    {al.name} &mdash; {al.sharePercent}% of the department
                  </span>
                  <span>{fmt(al.chargedPkr)}</span>
                </div>
              ))}
            </div>
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
