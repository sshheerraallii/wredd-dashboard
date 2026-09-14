// app/(protected)/app/admin/bd-commission/page.tsx
export const runtime = "nodejs";

import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma, BdCommissionTab } from "@prisma/client";

import { readSession } from "@/lib/auth";
import { resolveBdCommissionTabs } from "@/lib/bd-commission/state";
import {
  monthKeyFromDate,
  getActiveBdProjectsWithEstimates,
  getBdCommissionLedger,
} from "@/lib/bd-commission/queries";
import { fmtMoneyPkr } from "@/lib/bd-commission/totals";
import { getPrisma } from "@/lib/prisma";
import { computeBdSettlements } from "@/lib/bd-settlement/compute";

import {
  createBdAdjustment,
  markBdCommissionPaid,
  markBdAdjustmentPaid,
  bulkMarkBdCommissionPaid,
  bulkMarkBdAdjustmentPaid,
} from "./actions";

const prisma = getPrisma();

function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");
}

const BASE_HREF = "/app/admin/bd-commission";
type UiTab = "ACTIVE" | "CLEARING" | "DUE" | "PAID";

type SearchParams = {
  tab?: string | string[];
  monthKey?: string | string[];
  bdId?: string | string[];
  q?: string | string[];
  page?: string | string[];
  pageSize?: string | string[];
};

function first(v?: string | string[]) {
  return Array.isArray(v) ? v[0] : v;
}

function cleanTab(v?: string): UiTab {
  const t = (v ?? "DUE").toUpperCase();
  return t === "ACTIVE" || t === "CLEARING" || t === "DUE" || t === "PAID" ? (t as UiTab) : "DUE";
}

function norm(v?: string) {
  const s = (v ?? "").trim();
  return s.length ? s : "";
}

function toInt(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function qp(
  current: { tab: UiTab; monthKey: string; bdId: string; q: string; page: number; pageSize: number },
  patch?: Partial<{ tab: UiTab; monthKey: string; bdId: string; q: string; page: number; pageSize: number }>
) {
  const next = { ...current, ...(patch ?? {}) };
  const p = new URLSearchParams();

  p.set("tab", next.tab);
  if (next.monthKey) p.set("monthKey", next.monthKey);
  if (next.bdId) p.set("bdId", next.bdId);
  if (next.q) p.set("q", next.q);

  p.set("page", String(next.page));
  p.set("pageSize", String(next.pageSize));

  const s = p.toString();
  return s ? `${BASE_HREF}?${s}` : BASE_HREF;
}

function uiToLedgerTab(tab: UiTab): BdCommissionTab | null {
  if (tab === "CLEARING") return BdCommissionTab.CLEARING;
  if (tab === "DUE") return BdCommissionTab.DUE;
  if (tab === "PAID") return BdCommissionTab.PAID;
  return null;
}

function fmtWorkType(v: any) {
  const s = String(v ?? "");
  if (!s) return "-";
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function fmtPortal(v: any) {
  const s = String(v ?? "");
  if (!s) return "-";
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function pageWindow(page: number, totalPages: number) {
  const size = 7;
  const half = Math.floor(size / 2);

  let start = Math.max(1, page - half);
  let end = Math.min(totalPages, start + size - 1);
  start = Math.max(1, end - size + 1);

  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
}

function toNum(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function isNegative(v: any) {
  const n = toNum(v);
  return Number.isFinite(n) && n < 0;
}


function fmtUsd(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
  } catch {}
  return "-";
}

function fmtPct(v: any) {
  const n = toNum(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function feeUsdFrom(priceUsdRaw: any, feePercentRaw: any, feeUsdRaw: any) {
  const price = toNum(priceUsdRaw);
  const pct = toNum(feePercentRaw);
  const feeUsdDb = feeUsdRaw == null ? null : toNum(feeUsdRaw);

  const feeUsd =
    feeUsdDb != null && feeUsdDb > 0 ? feeUsdDb : price > 0 && pct > 0 ? (price * pct) / 100 : 0;

  return { price, pct, feeUsd };
}

function fmtOnsiteEffort(hoursRaw: any, costPkrRaw?: any) {
  const hours = Number(hoursRaw ?? 0);
  if (!hours) return "—";
  if (costPkrRaw != null) {
    const cost = Number(costPkrRaw ?? 0);
    if (cost > 0) return `${hours} hrs · ${fmtMoneyPkr(cost)}`;
  }
  return `${hours} hrs`;
}

function fmtRemoteSpent(overheadPkrRaw: any, workerPayoutPkrRaw: any) {
  const overhead = Number(overheadPkrRaw ?? 0);
  const workerPay = Number(workerPayoutPkrRaw ?? 0);
  const total = overhead + workerPay;
  if (!total && !overhead && !workerPay) return "—";
  if (!workerPay) return fmtMoneyPkr(overhead); // legacy rows with no workerPayoutPkr
  return `${fmtMoneyPkr(overhead)} + ${fmtMoneyPkr(workerPay)} = ${fmtMoneyPkr(total)}`;
}

// Server-action wrapper for <form action=...>
async function createAdjAction(formData: FormData) {
  "use server";
  const bdUserId = String(formData.get("bdUserId") ?? "");
  const monthKey = String(formData.get("monthKey") ?? "");
  const amountPkr = String(formData.get("amountPkr") ?? "0");
  const note = String(formData.get("note") ?? "");
  const returnTo = String(formData.get("returnTo") ?? BASE_HREF);

  await createBdAdjustment({ bdUserId, monthKey, amountPkr, note, returnTo });
}

async function markRowPaidAction(formData: FormData) {
  "use server";
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("returnTo") ?? BASE_HREF);

  if (kind === "adjustment") {
    await markBdAdjustmentPaid({ id, returnTo });
  } else {
    await markBdCommissionPaid({ id, returnTo });
  }
}

async function markAllPaidOnPageAction(formData: FormData) {
  "use server";
  const returnTo = String(formData.get("returnTo") ?? BASE_HREF);

  // ids come in as repeated hidden inputs: <input name="commissionIds" ... />
  const commissionIds = formData.getAll("commissionIds").map(String).filter(Boolean);
  const adjustmentIds = formData.getAll("adjustmentIds").map(String).filter(Boolean);

  if (commissionIds.length) await bulkMarkBdCommissionPaid({ ids: commissionIds, returnTo });
  if (adjustmentIds.length) await bulkMarkBdAdjustmentPaid({ ids: adjustmentIds, returnTo });

  redirect(returnTo);
}

export default async function AdminBdCommissionPage({ searchParams }: { searchParams?: SearchParams }) {
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  await resolveBdCommissionTabs();

  const tab: UiTab = cleanTab(first(searchParams?.tab));
  const monthKeyRaw = norm(first(searchParams?.monthKey));
  const bdIdRaw = norm(first(searchParams?.bdId));
  const qRaw = norm(first(searchParams?.q));

  const rawPage = first(searchParams?.page);
  const rawPageSize = first(searchParams?.pageSize);

  const pageSizeAllowed = [10, 20, 50, 100] as const;
  const pageSize = (pageSizeAllowed.includes(toInt(rawPageSize, 20) as any)
    ? toInt(rawPageSize, 20)
    : 20) as (typeof pageSizeAllowed)[number];

  const page = Math.max(1, toInt(rawPage, 1));
  const current = { tab, monthKey: monthKeyRaw, bdId: bdIdRaw, q: qRaw, page, pageSize };

  const bds = await prisma.user.findMany({
    where: { role: "BUSINESS_DEVELOPER" },
    select: { id: true, fullName: true, username: true },
    orderBy: { fullName: "asc" },
  });

  const monthKeyForInput = tab === "ACTIVE" ? monthKeyRaw || monthKeyFromDate(new Date()) : monthKeyRaw;

  const ledgerTab = uiToLedgerTab(tab);

  let totalCount = 0;
  let rows: any[] = [];
  let totals = { count: 0, profitPkr: 0, bdPayoutPkr: 0, companySharePkr: 0 };

  if (tab === "ACTIVE") {
    const estimateMonthKey = monthKeyRaw || monthKeyFromDate(new Date());

    let res = await getActiveBdProjectsWithEstimates({
      bdId: bdIdRaw || undefined,
      search: qRaw || undefined,
      monthKey: estimateMonthKey,
      page,
      perPage: pageSize,
    });

    totalCount = res.total;

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const safePage = clamp(page, 1, totalPages);
    current.page = safePage;

    if (safePage !== page) {
      res = await getActiveBdProjectsWithEstimates({
        bdId: bdIdRaw || undefined,
        search: qRaw || undefined,
        monthKey: estimateMonthKey,
        page: safePage,
        perPage: pageSize,
      });
      totalCount = res.total;
    }

    rows = res.rows;
    totals = res.totals;
  } else {
    if (!ledgerTab) {
      totalCount = 0;
      rows = [];
      totals = { count: 0, profitPkr: 0, bdPayoutPkr: 0, companySharePkr: 0 };
    } else {
      let res = await getBdCommissionLedger({
        tab: ledgerTab,
        monthKey: monthKeyRaw || undefined,
        bdId: bdIdRaw || undefined,
        search: qRaw || undefined,
        page,
        perPage: pageSize,
      });

      totalCount = res.total;

      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const safePage = clamp(page, 1, totalPages);
      current.page = safePage;

      if (safePage !== page) {
        res = await getBdCommissionLedger({
          tab: ledgerTab,
          monthKey: monthKeyRaw || undefined,
          bdId: bdIdRaw || undefined,
          search: qRaw || undefined,
          page: safePage,
          perPage: pageSize,
        });
        totalCount = res.total;
      }

      rows = res.rows;
      totals = res.totals;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIdx = totalCount === 0 ? 0 : (current.page - 1) * pageSize + 1;
  const endIdx = Math.min(totalCount, (current.page - 1) * pageSize + rows.length);
  const pagerPages = pageWindow(current.page, totalPages);

  const defaultAdjMonth = monthKeyFromDate(new Date());
  const returnToForAdj = qp({ ...current }, { tab: "CLEARING", page: 1 });

  // Monthly settlement summary — the figures that actually decide payouts.
  // The per-project table below is margin analysis and no longer the payable.
  let settlementRun: Awaited<ReturnType<typeof computeBdSettlements>> | null = null;
  let settlementError: string | null = null;
  const settlementMonth = /^\d{4}-\d{2}$/.test(monthKeyForInput ?? "")
    ? (monthKeyForInput as string)
    : monthKeyFromDate(new Date());
  try {
    settlementRun = await computeBdSettlements(settlementMonth);
  } catch (e) {
    settlementError = e instanceof Error ? e.message : "Settlement unavailable.";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">BD Commissions</h1>
          <p className="text-sm text-muted-foreground">
            Payouts are settled monthly (top). The per-project table below is
            margin analysis only.
          </p>
        </div>
      </div>

      {/* ── Monthly settlement (absorption costing) ── */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-sm font-medium">
              Monthly settlement &mdash; {settlementMonth}
            </div>
            <p className="text-xs text-muted-foreground">
              revenue &minus; remote payouts &minus; cost base = profit; payout
              = profit &times; rate
            </p>
          </div>
          <Link
            href={`/app/bd/settlement?month=${settlementMonth}`}
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Full settlement view &rarr;
          </Link>
        </div>

        {settlementRun?.isCurrentMonth ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-2">
            <p className="text-xs text-muted-foreground">
              Month in progress &mdash; {settlementRun.elapsedWorkDays} of{" "}
              {settlementRun.workDaysInMonth} working days elapsed, cost base
              charged at {settlementRun.prorationPct}%.
            </p>
          </div>
        ) : null}

        {settlementError ? (
          <p className="text-sm text-red-600">{settlementError}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="p-2">BD</th>
                  <th className="p-2">Revenue</th>
                  <th className="p-2">Remote payouts</th>
                  <th className="p-2">Cost base</th>
                  <th className="p-2">Project margin</th>
                  <th className="p-2">Rate</th>
                  <th className="p-2">Payout</th>
                  <th className="p-2">Capacity used</th>
                </tr>
              </thead>
              <tbody>
                {(settlementRun?.settlements ?? []).map((x) => (
                  <tr key={x.bdId} className="border-t">
                    <td className="p-2">
                      <Link
                        className="underline"
                        href={`/app/bd/settlement?month=${settlementMonth}&bd=${x.bdId}`}
                      >
                        {x.bdName}
                      </Link>
                    </td>
                    <td className="p-2">{fmtMoneyPkr(x.revenuePkr)}</td>
                    <td className="p-2">{fmtMoneyPkr(x.remotePayoutPkr)}</td>
                    <td className="p-2">
                      {fmtMoneyPkr(x.costBasePkr)}
                      <span className="block text-[11px] text-muted-foreground">
                        sal {fmtMoneyPkr(x.costSalariesPkr)} + ovh{" "}
                        {fmtMoneyPkr(x.costOverheadPkr)}
                      </span>
                    </td>
                    <td className={`p-2 ${x.profitPkr < 0 ? "text-red-600" : ""}`}>
                      {fmtMoneyPkr(x.profitPkr)}
                    </td>
                    <td className="p-2">{(x.bdRate * 100).toFixed(0)}%</td>
                    <td className="p-2 font-semibold">
                      {fmtMoneyPkr(x.payoutPkr)}
                    </td>
                    <td className="p-2">
                      {Math.round(x.usedHours).toLocaleString()} /{" "}
                      {Math.round(x.capacityHours).toLocaleString()} h
                      <span className="block text-[11px] text-muted-foreground">
                        {x.capacityHours > 0
                          ? Math.round((x.usedHours / x.capacityHours) * 100)
                          : 0}
                        %
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {settlementRun && settlementRun.warnings.length > 0 ? (
          <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-500">
            {settlementRun.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Add Adjustment */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Add Adjustment (manual)</div>
        <form action={createAdjAction} className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="returnTo" value={returnToForAdj} />

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">BD</label>
            <select name="bdUserId" className="border rounded px-2 py-1 text-sm" required>
              <option value="">Select BD</option>
              {bds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fullName} @{b.username}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">MonthKey (YYYY-MM)</label>
            <input
              name="monthKey"
              defaultValue={defaultAdjMonth}
              className="border rounded px-2 py-1 text-sm"
              placeholder={defaultAdjMonth}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Amount (PKR)</label>
            <input
              name="amountPkr"
              className="border rounded px-2 py-1 text-sm"
              placeholder="e.g. 5000 or -2500"
              required
            />
          </div>

          <div className="flex flex-col gap-1 min-w-[280px]">
            <label className="text-xs text-muted-foreground">Reason / Note</label>
            <input name="note" className="border rounded px-2 py-1 text-sm" placeholder="Why this adjustment?" required />
          </div>

          <button className="border rounded px-3 py-1 text-sm">Add</button>
          <div className="text-xs text-muted-foreground">
            Creates a CLEARING ledger row. Resolver will move it to DUE on due date.
          </div>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(["ACTIVE", "CLEARING", "DUE", "PAID"] as const).map((t) => (
          <Link
            key={t}
            href={qp(current, { tab: t, page: 1 })}
            className={`px-3 py-1 rounded border text-sm transition ${tab === t ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded border p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">
            MonthKey (YYYY-MM) — blank = {tab === "ACTIVE" ? "defaults to current month" : "All months"}
          </label>
          <input
            defaultValue={monthKeyForInput}
            name="monthKey"
            placeholder={monthKeyFromDate(new Date())}
            className="border rounded px-2 py-1 text-sm"
            form="filters"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">BD</label>
          <select defaultValue={bdIdRaw} name="bdId" className="border rounded px-2 py-1 text-sm" form="filters">
            <option value="">All</option>
            {bds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullName} @{b.username}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-[260px]">
          <label className="text-xs text-muted-foreground">Search</label>
          <input
            defaultValue={qRaw}
            name="q"
            placeholder="projectId / title / clientName / clientUsername / note"
            className="border rounded px-2 py-1 text-sm"
            form="filters"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Per page</label>
          <select defaultValue={String(pageSize)} name="pageSize" className="border rounded px-2 py-1 text-sm" form="filters">
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <form id="filters" action={BASE_HREF} className="flex gap-2 items-center">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="page" value="1" />
          <button className="border rounded px-3 py-1 text-sm">Apply</button>
          <Link className="text-sm underline" href={qp({ ...current, page: 1 }, { monthKey: "", bdId: "", q: "" })}>
            Reset
          </Link>
        </form>
      </div>

      <div className="text-sm text-muted-foreground">
        {totalCount === 0 ? "Showing 0 results" : `Showing ${startIdx}-${endIdx} of ${totalCount}`}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Rows (total)</div>
          <div className="text-lg font-semibold">{totals.count}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">{tab === "ACTIVE" ? "Project margin (PKR, est.)" : "Project margin (PKR)"}</div>
          <div className="text-lg font-semibold">{fmtMoneyPkr(totals.profitPkr)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">BD Payout (PKR)</div>
          <div className="text-lg font-semibold">{tab === "ACTIVE" ? "-" : fmtMoneyPkr(totals.bdPayoutPkr)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Company Share (PKR)</div>
          <div className="text-lg font-semibold">{tab === "ACTIVE" ? "-" : fmtMoneyPkr(totals.companySharePkr)}</div>
        </div>
      </div>

      {/* Bulk Mark Paid (DUE only) */}
      {tab === "DUE" && rows.length > 0 ? (
        <div className="rounded border p-3 flex items-center justify-between gap-2">
          <div className="text-sm">
            <div className="font-medium">Bulk action</div>
            <div className="text-xs text-muted-foreground">
              Marks all DUE rows on this page as PAID (commissions + adjustments).
            </div>
          </div>

          <form action={markAllPaidOnPageAction}>
            <input type="hidden" name="returnTo" value={qp(current, { tab: "DUE" })} />

            {rows
              .filter((r: any) => r?.kind === "adjustment")
              .map((r: any) => (
                <input key={`a:${r.id}`} type="hidden" name="adjustmentIds" value={r.id} />
              ))}

            {rows
              .filter((r: any) => r?.kind !== "adjustment")
              .map((r: any) => (
                <input key={`c:${r.id}`} type="hidden" name="commissionIds" value={r.id} />
              ))}

            <button className="border rounded px-3 py-1 text-sm">Mark ALL (this page) Paid</button>
          </form>
        </div>
      ) : null}

      {/* Pagination */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Page {current.page} / {totalPages}
        </div>

        <div className="flex items-center gap-1">
          <Link
            className={`px-2 py-1 rounded border text-sm ${current.page <= 1 ? "pointer-events-none opacity-50" : ""}`}
            href={qp(current, { page: Math.max(1, current.page - 1) })}
          >
            Prev
          </Link>

          {pagerPages[0] > 1 ? (
            <>
              <Link className="px-2 py-1 rounded border text-sm" href={qp(current, { page: 1 })}>
                1
              </Link>
              <span className="px-1 text-sm text-muted-foreground">…</span>
            </>
          ) : null}

          {pagerPages.map((p) => (
            <Link
              key={p}
              className={`px-2 py-1 rounded border text-sm transition ${p === current.page ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"}`}
              href={qp(current, { page: p })}
            >
              {p}
            </Link>
          ))}

          {pagerPages[pagerPages.length - 1] < totalPages ? (
            <>
              <span className="px-1 text-sm text-muted-foreground">…</span>
              <Link className="px-2 py-1 rounded border text-sm" href={qp(current, { page: totalPages })}>
                {totalPages}
              </Link>
            </>
          ) : null}

          <Link
            className={`px-2 py-1 rounded border text-sm ${current.page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
            href={qp(current, { page: Math.min(totalPages, current.page + 1) })}
          >
            Next
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="rounded border overflow-auto">
        <table className="min-w-[1400px] w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              <th className="p-2">Project</th>
              <th className="p-2">BD</th>
              <th className="p-2">Client</th>
              <th className="p-2">Portal</th>
              <th className="p-2">Work</th>
              <th className="p-2">Effort / Spent</th>
              <th className="p-2">Price</th>
              <th className="p-2">Fee %</th>
              <th className="p-2">Fee (USD)</th>
              <th className="p-2">Profit</th>
              <th className="p-2">BD Payout</th>
              <th className="p-2">Company</th>
              <th className="p-2">Due</th>
              <th className="p-2">{tab === "PAID" ? "Paid At" : "Payable"}</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-4 text-muted-foreground" colSpan={15}>
                  No rows.
                </td>
              </tr>
            ) : tab === "ACTIVE" ? (
              rows.map((r: any) => {
                const workType = r.finance?.workType;
               const effort = workType === "ONSITE"
                  ? fmtOnsiteEffort(r.finance?.allowedHours, null)
                  : "Remote overhead (fixed)";

                const { pct, feeUsd } = feeUsdFrom(
                  r.finance?.priceUsd,
                  r.finance?.platformFeePercent,
                  r.finance?.platformFeeUsd
                );

                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">
                      <Link className="underline" href={`/app/projects/${r.id}`}>
                        {r.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.id}</div>
                    </td>

                    <td className="p-2">
                      {r.bdOwner?.fullName ?? "-"}{" "}
                      <span className="text-xs text-muted-foreground">@{r.bdOwner?.username ?? "-"}</span>
                    </td>

                    <td className="p-2">
                      {r.finance?.clientName ?? "-"}
                      <div className="text-xs text-muted-foreground">{r.finance?.clientUsername ?? ""}</div>
                    </td>

                    <td className="p-2">{fmtPortal(r.finance?.portal)}</td>
                    <td className="p-2">{fmtWorkType(workType)}</td>
                    <td className="p-2">{effort}</td>
                    <td className="p-2">{fmtUsd(r.finance?.priceUsd)}</td>
                    <td className="p-2">{pct > 0 ? fmtPct(pct) : "-"}</td>
                    <td className="p-2">{feeUsd > 0 ? fmtUsd(feeUsd) : "-"}</td>

                    <td className="p-2">
                      {r.estimatedProfitPkr == null ? "-" : fmtMoneyPkr(Number(r.estimatedProfitPkr))}
                      {!r.estimateHasConfig ? (
                        <div className="text-xs text-red-600">Missing MonthlyFinanceConfig</div>
                      ) : null}
                    </td>

                    <td className="p-2">-</td>
                    <td className="p-2">-</td>
                    <td className="p-2">-</td>
                    <td className="p-2">-</td>
                    <td className="p-2">-</td>
                  </tr>
                );
              })
            ) : (
              rows.map((r: any) => {
                const isAdj = r.kind === "adjustment";
                const spent = isAdj
                  ? "-"
                  : r.workType === "REMOTE"
                    ? fmtRemoteSpent(r.overheadPkr, r.workerPayoutPkr)
                    : fmtOnsiteEffort(r.allowedHours, r.overheadPkr);

                // prefer ledger snapshot fields, else fall back to project.finance if present
                const priceUsdRaw = isAdj ? null : (r.priceUsd ?? r.project?.finance?.priceUsd);
                const feePctRaw = isAdj ? null : (r.platformFeePercent ?? r.project?.finance?.platformFeePercent);
                const feeUsdRaw = isAdj ? null : (r.platformFeeUsd ?? r.project?.finance?.platformFeeUsd);

                const { pct, feeUsd } = feeUsdFrom(priceUsdRaw, feePctRaw, feeUsdRaw);

                return (
                  <tr key={`${r.kind}:${r.id}`} className="border-t">
                    <td className="p-2">
                      {isAdj ? (
                        <>
                          <div className="font-medium">Adjustment</div>
                          <div className="text-xs text-muted-foreground">{r.__note ?? "-"}</div>
                          <div className="text-xs text-muted-foreground">monthKey: {r.completedMonthKey}</div>
                        </>
                      ) : (
                        <>
                          <Link className="underline" href={`/app/projects/${r.projectId}`}>
                            {r.project?.title ?? r.projectId}
                          </Link>
                          <div className="text-xs text-muted-foreground">{r.projectId}</div>
                          <div className="text-xs text-muted-foreground">completedMonthKey: {r.completedMonthKey}</div>
                        </>
                      )}
                    </td>

                    <td className="p-2">
                      {r.bd?.fullName ?? "-"}{" "}
                      <span className="text-xs text-muted-foreground">@{r.bd?.username ?? "-"}</span>
                    </td>

                    <td className="p-2">
                      {isAdj ? "-" : r.project?.finance?.clientName ?? "-"}
                      <div className="text-xs text-muted-foreground">
                        {isAdj ? "" : r.project?.finance?.clientUsername ?? ""}
                      </div>
                    </td>

                    <td className="p-2">{isAdj ? "-" : fmtPortal(r.portal)}</td>
                    <td className="p-2">{isAdj ? "-" : fmtWorkType(r.workType)}</td>
                    <td className="p-2">{spent}</td>

                    <td className="p-2">{isAdj ? "-" : fmtUsd(priceUsdRaw)}</td>
                    <td className="p-2">{isAdj ? "-" : pct > 0 ? fmtPct(pct) : "-"}</td>
                    <td className="p-2">{isAdj ? "-" : feeUsd > 0 ? fmtUsd(feeUsd) : "-"}</td>

<td className={`p-2 ${isNegative(r.profitPkr) ? "text-red-600 font-medium" : ""}`}>
                      {fmtMoneyPkr(Number(r.profitPkr ?? 0))}
                    </td>
                    <td className={`p-2 ${isNegative(r.bdPayoutPkr) ? "text-red-600 font-medium" : ""}`}>
                      {fmtMoneyPkr(Number(r.bdPayoutPkr ?? 0))}
                    </td>
                    <td className={`p-2 ${isNegative(r.companySharePkr) ? "text-red-600 font-medium" : ""}`}>
                      {fmtMoneyPkr(Number(r.companySharePkr ?? 0))}
                    </td>
                    <td className="p-2">{r.dueOn ? new Date(r.dueOn).toLocaleDateString() : "-"}</td>

                    <td className="p-2">
                      {tab === "PAID"
                        ? r.paidAt
                          ? new Date(r.paidAt).toLocaleDateString()
                          : "-"
                        : r.payableOn
                          ? new Date(r.payableOn).toLocaleDateString()
                          : "-"}
                    </td>

                    <td className="p-2">
                      {tab === "DUE" ? (
                        <form action={markRowPaidAction}>
                          <input type="hidden" name="kind" value={r.kind ?? "commission"} />
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="returnTo" value={qp(current)} />
                          <button className="border rounded px-2 py-1 text-xs">Mark Paid</button>
                        </form>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
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