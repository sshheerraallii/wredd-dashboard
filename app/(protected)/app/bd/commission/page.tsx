// app/(protected)/app/bd/commission/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BdCommissionTab } from "@prisma/client";

import { resolveBdCommissionTabs } from "@/lib/bd-commission/resolve";
import { getActiveBdProjectsWithEstimates, getBdCommissionLedger } from "@/lib/bd-commission/queries";
import { computeDepartmentCostBase, blendedHourCostPkr } from "@/lib/bd-settlement/cost-base";
import { computeBdSettlements } from "@/lib/bd-settlement/compute";

type UiTab = "ACTIVE" | "CLEARING" | "DUE" | "PAID";

function normUiTab(v?: string | null): UiTab {
  const t = (v ?? "").toUpperCase();
  if (t === "ACTIVE" || t === "CLEARING" || t === "DUE" || t === "PAID") return t as UiTab;
  return "ACTIVE";
}

function normPage(v?: string | null) {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 1;
}

function normPerPage(v?: string | null) {
  const n = Number(v);
  if (n === 10 || n === 20 || n === 50 || n === 100) return n;
  return 20;
}

function toNum(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function fmtUsd(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    if (Number.isFinite(n)) return n.toFixed(2);
  } catch {}
  return String(v ?? "-");
}

function fmtPct(v: any) {
  const n = toNum(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function fmtPkr(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    if (Number.isFinite(n)) return n.toLocaleString();
  } catch {}
  return String(v ?? "-");
}

function fmtDate(d?: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}

export default async function BdCommissionPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  // Support both current and legacy role values; middleware already gates the route.
  const role = String(session.user.role ?? "");
  if (role !== "BUSINESS_DEVELOPER" && role !== "BD") redirect("/app/projects?err=forbidden");

  // force BD self-only
  const bdId = session.user.id;

  // resolver on load (same as admin)
  const prisma = getPrisma();
  await resolveBdCommissionTabs(prisma);

  const sp = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };

  const tab = normUiTab(sp("tab"));
  const monthKey = (sp("monthKey") ?? "").trim() || undefined;
  const search = (sp("search") ?? "").trim() || undefined;
  const page = normPage(sp("page"));
  const perPage = normPerPage(sp("perPage") ?? sp("pageSize")); // support either param name

  const mkUrl = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();

    const current: Record<string, string> = {
      tab,
      monthKey: monthKey ?? "",
      search: search ?? "",
      page: String(page),
      perPage: String(perPage),
    };

    for (const [k, v] of Object.entries({ ...current, ...patch })) {
      const vv = (v ?? "").toString();
      if (!vv.trim()) continue;
      p.set(k, vv);
    }

    return `/app/bd/commission?${p.toString()}`;
  };

  // Fetch
  let total = 0;
  let rows: any[] = [];
  let activeMeta: { monthKeyUsed?: string; hasConfig?: boolean } = {};
  let monthTotalPkr: number | null = null;

  if (tab === "ACTIVE") {
    const res = await getActiveBdProjectsWithEstimates({
      bdId,
      search,
      monthKey, // ACTIVE uses this as config monthKey (defaults internally)
      page,
      perPage,
    });

    total = res.total;
    rows = res.rows;
    activeMeta = { monthKeyUsed: res.monthKeyUsed, hasConfig: res.hasConfig };

    // Prefer server-provided total if available, else compute from returned rows (page-only)
    const provided = (res as any)?.totalPayoutPkr;
    if (typeof provided === "number") {
      monthTotalPkr = provided;
    } else {
      monthTotalPkr = rows.reduce((sum, r) => {
        const v = r?.estimatedProfitPkr;
        const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0);
    }
  } else {
    const ledgerTab = tab as BdCommissionTab; // CLEARING/DUE/PAID
    const res = await getBdCommissionLedger({
      tab: ledgerTab,
      bdId,
      monthKey, // ledger filters completedMonthKey
      search,
      page,
      perPage,
    });

    total = res.total;
    rows = res.rows;

    // Prefer server-provided total if available, else compute from returned rows (page-only)
    const provided = (res as any)?.totalPayoutPkr;
    if (typeof provided === "number") {
      monthTotalPkr = provided;
    } else if (tab === "DUE" || tab === "CLEARING") {
      monthTotalPkr = rows.reduce((sum, r) => {
        const v = r?.bdPayoutPkr;
        const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0);
    } else {
      monthTotalPkr = null;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;
  const rangeFrom = total === 0 ? 0 : offset + 1;
  const rangeTo = Math.min(total, offset + rows.length);

  // Totals card for ACTIVE + CLEARING + DUE
  const showTotalCard = tab === "ACTIVE" || tab === "DUE" || tab === "CLEARING" || tab === "PAID";

  const totalLabel =
    tab === "ACTIVE"
      ? "ACTIVE total (PKR)"
      : tab === "DUE"
      ? "DUE total (PKR)"
      : tab === "CLEARING"
      ? "CLEARING total (PKR)"
      : tab === "PAID"
      ? "PAID total (PKR)"
      : "";

  const totalMonthLabel =
    tab === "ACTIVE" ? activeMeta.monthKeyUsed ?? (monthKey ?? "-") : monthKey ?? "All";

  // Contribution = what a project clears against the cost of the hours it used,
  // priced at FULL capacity. It is a per-project quality score, never a payout.
  let blendedRate = 0;
  let breakEven: { revenue: number; used: number; capacity: number; contribution: number } | null =
    null;
  const hoursByProject = new Map<string, number>();

  if (tab === "ACTIVE" && rows.length > 0) {
    try {
      const mk = activeMeta?.monthKeyUsed ?? monthKey ?? "";
      if (/^\d{4}-\d{2}$/.test(mk)) {
        const cb = await computeDepartmentCostBase(mk);
        blendedRate = blendedHourCostPkr(cb);

        const assignments = await prisma.projectAssignment.findMany({
          where: {
            projectId: { in: rows.map((r: any) => r.id) },
            unassignedAt: null,
          },
          select: { projectId: true, allocatedHours: true },
        });
        for (const a of assignments) {
          hoursByProject.set(
            a.projectId,
            (hoursByProject.get(a.projectId) ?? 0) + (a.allocatedHours ?? 0)
          );
        }

        const run = await computeBdSettlements(mk);
        const mine = run.settlements.find((x) => x.bdId === bdId);
        if (mine) {
          breakEven = {
            revenue: mine.costBaseFullPkr,
            used: mine.usedHours,
            capacity: mine.capacityHours,
            contribution: 0,
          };
        }
      }
    } catch {
      // Contribution is decoration — never break the ledger over it.
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-2xl border bg-muted/40 p-4">
        <div className="text-sm font-medium">
          Commission is now settled monthly
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          What you are paid is calculated once per month: revenue delivered,
          minus remote payouts, minus your share of the team&apos;s running cost.
          The per-project figures below are for margin analysis &mdash;{" "}
          <strong>Contribution</strong> shows what a job clears against the cost
          of the hours it used, priced at full capacity. It is not your
          commission, and no single project decides your payout.
        </p>
        <Link
          href="/app/bd/settlement"
          className="mt-3 inline-block rounded-xl border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Open monthly settlement &rarr;
        </Link>

        {breakEven ? (
          <div className="mt-3 rounded-xl border bg-background p-3">
            <p className="text-sm leading-relaxed">
              This month: <strong>{rows.length}</strong> project(s),{" "}
              <strong>{Math.round(breakEven.used).toLocaleString()}</strong>{" "}
              hours used of{" "}
              <strong>{Math.round(breakEven.capacity).toLocaleString()}</strong>{" "}
              available. You break even at{" "}
              <strong>{fmtPkr(breakEven.revenue)} PKR</strong> of revenue.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-3">

        <div>
          <h1 className="text-xl font-semibold">My Commissions</h1>
          <p className="text-sm text-muted-foreground">
            ACTIVE = estimate (UI-only). CLEARING/DUE/PAID = ledger rows.
          </p>
          {tab === "ACTIVE" ? (
            <p className="text-xs text-muted-foreground mt-1">
              Config month: <span className="font-medium">{activeMeta.monthKeyUsed ?? "-"}</span>
              {activeMeta.hasConfig ? "" : " • (Missing month config)"}
            </p>
          ) : null}
        </div>

        <Link className="text-sm underline" href="/app/bd">
          Back
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(["ACTIVE", "CLEARING", "DUE", "PAID"] as UiTab[]).map((t) => (
          <Link key={t} href={mkUrl({ tab: t, page: "1" })}>
            <Button variant={tab === t ? "default" : "secondary"}>{t}</Button>
          </Link>
        ))}
      </div>

      {/* Totals card (ACTIVE + CLEARING + DUE) */}
      {showTotalCard ? (
        <div className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{totalLabel}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Month: {totalMonthLabel}</div>
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {monthTotalPkr == null ? "-" : fmtPkr(monthTotalPkr)}
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <form className="grid grid-cols-1 md:grid-cols-4 gap-3" action={mkUrl({ page: "1" })}>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Month key</div>
          <Input name="monthKey" defaultValue={monthKey ?? ""} placeholder="e.g. 2026-02" />
        </div>

        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-muted-foreground">Search</div>
          <Input
            name="search"
            defaultValue={search ?? ""}
            placeholder="Project title / client / username / id..."
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Per page</div>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            name="perPage"
            defaultValue={String(perPage)}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="page" value="1" />

        <div className="md:col-span-4 flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href={mkUrl({ monthKey: "", search: "", page: "1" })}>
            <Button type="button" variant="secondary">
              Reset
            </Button>
          </Link>
        </div>
      </form>

      {/* Range + pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-muted-foreground">
          Showing <span className="font-medium text-foreground">{rangeFrom}</span>–
          <span className="font-medium text-foreground">{rangeTo}</span> of{" "}
          <span className="font-medium text-foreground">{total}</span>
        </div>

        <div className="flex items-center gap-2">
          <Link href={mkUrl({ page: String(Math.max(1, page - 1)) })}>
            <Button variant="secondary" disabled={page <= 1}>
              Prev
            </Button>
          </Link>

          <div className="text-muted-foreground">
            Page <span className="font-medium text-foreground">{page}</span> /{" "}
            <span className="font-medium text-foreground">{totalPages}</span>
          </div>

          <Link href={mkUrl({ page: String(Math.min(totalPages, page + 1)) })}>
            <Button variant="secondary" disabled={page >= totalPages}>
              Next
            </Button>
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="min-w-[1250px] w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-3">Project</th>
              <th className="p-3">Portal</th>
              <th className="p-3">Work type</th>
              <th className="p-3">Price (USD)</th>
              <th className="p-3">Fee %</th>
              <th className="p-3">Fee (USD)</th>
              <th className="p-3">Tab</th>
              <th className="p-3">Month</th>
              <th className="p-3">Due</th>
              <th className="p-3">{tab === "ACTIVE" ? "Contribution (PKR)" : "BD Payout (PKR)"}</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-6 text-muted-foreground" colSpan={10}>
                  No rows.
                </td>
              </tr>
            ) : tab === "ACTIVE" ? (
              rows.map((p: any) => {
                const f = p.finance;

                const price = toNum(f?.priceUsd);
                const feePct = toNum(f?.platformFeePercent);
                const feeUsdDb = f?.platformFeeUsd == null ? null : toNum(f.platformFeeUsd);
                const feeUsd =
                  feeUsdDb != null && feeUsdDb > 0 ? feeUsdDb : price > 0 && feePct > 0 ? (price * feePct) / 100 : 0;

                return (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">
                      <Link className="underline" href={`/app/projects/${p.id}`}>
                        {p.title ?? p.id}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.id}</div>
                      {f?.clientName ? (
                        <div className="text-xs text-muted-foreground">{f.clientName}</div>
                      ) : null}
                    </td>
                    <td className="p-3">{f?.portal ?? "-"}</td>
                    <td className="p-3">{f?.workType ?? "-"}</td>
                    <td className="p-3">{fmtUsd(f?.priceUsd)}</td>
                    <td className="p-3">{fmtPct(f?.platformFeePercent)}</td>
                    <td className="p-3">{feeUsd > 0 ? fmtUsd(feeUsd) : "-"}</td>
                    <td className="p-3">ACTIVE</td>
                    <td className="p-3">{p.estimateMonthKey ?? "-"}</td>
                    <td className="p-3">-</td>
                    <td className="p-3">
                      {(() => {
                        if (blendedRate <= 0) return "-";
                        const hrs = hoursByProject.get(p.id) ?? 0;
                        const net = toNum(p.netPkr ?? f?.netPkr);
                        if (net <= 0) return "-";
                        const contribution = net - hrs * blendedRate;
                        return (
                          <span className={contribution < 0 ? "text-red-600" : ""}>
                            {fmtPkr(Math.round(contribution))}
                            <span className="block text-[11px] text-muted-foreground">
                              {hrs}h &times; {blendedRate}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })
            ) : (
  rows.map((r: any) => {
    const isAdj = r?.kind === "adjustment";
    const proj = r.project;

    const client = isAdj
      ? "-"
      : proj?.finance?.clientName ?? proj?.finance?.clientUsername ?? "-";

    // Prefer ledger snapshot fields if present, else fall back to project.finance
    const price = isAdj ? 0 : toNum(r?.priceUsd ?? proj?.finance?.priceUsd);
    const feePct = isAdj ? 0 : toNum(r?.platformFeePercent ?? proj?.finance?.platformFeePercent);
    const feeUsdDbRaw = isAdj ? null : (r?.platformFeeUsd ?? proj?.finance?.platformFeeUsd ?? null);
    const feeUsdDb = feeUsdDbRaw == null ? null : toNum(feeUsdDbRaw);
    const feeUsd =
      feeUsdDb != null && feeUsdDb > 0 ? feeUsdDb : price > 0 && feePct > 0 ? (price * feePct) / 100 : 0;

    return (
      <tr key={`${r.kind ?? "commission"}:${r.id}`} className="border-t">
        <td className="p-3">
          {isAdj ? (
            <>
              <div className="font-medium">Adjustment</div>
              <div className="text-xs text-muted-foreground">{r.__note ?? "-"}</div>
              <div className="text-xs text-muted-foreground">monthKey: {r.completedMonthKey ?? "-"}</div>
            </>
          ) : (
            <>
              <Link className="underline" href={`/app/projects/${r.projectId}`}>
                {proj?.title ?? r.projectId}
              </Link>
              <div className="text-xs text-muted-foreground">{client}</div>
            </>
          )}
        </td>

        <td className="p-3">{isAdj ? "-" : (r.portal ?? proj?.finance?.portal ?? "-")}</td>
        <td className="p-3">{isAdj ? "-" : (r.workType ?? proj?.finance?.workType ?? "-")}</td>

        <td className="p-3">{isAdj ? "-" : fmtUsd(price)}</td>
        <td className="p-3">{isAdj ? "-" : feePct > 0 ? fmtPct(feePct) : "-"}</td>
        <td className="p-3">{isAdj ? "-" : feeUsd > 0 ? fmtUsd(feeUsd) : "-"}</td>

        <td className="p-3">{r.tab}</td>
        <td className="p-3">{r.completedMonthKey ?? "-"}</td>
        <td className="p-3">{fmtDate(r.dueOn)}</td>
        <td className="p-3">{fmtPkr(r.bdPayoutPkr)}</td>
      </tr>
    );
  })
)}
          </tbody>
        </table>
      </div>
    </div>
  );
}