// app/(protected)/app/admin/finance-config/page.tsx
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  createMonth,
  finalizeMonth,
  unfinalizeMonth,
  recalculateMonth,
  updateMonth,
} from "./actions";

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
                {isFinalized && (
                  <form
                    action={unfinalizeMonth}
                    onSubmit={(e) => {
                      if (
                        !confirm(
                          `Unlock ${selected}? You can edit values and re-finalize after.`
                        )
                      )
                        e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="monthKey" value={selected} />
                    <button className="rounded-xl border border-amber-400 text-amber-700 bg-amber-50 px-4 py-2 text-sm hover:bg-amber-100 transition-colors">
                      Unfinalize (Unlock)
                    </button>
                  </form>
                )}

                {/* Recalculate — always available when row exists */}
                <form
                  action={recalculateMonth}
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `Recalculate all BD commission rows for ${selected}?\n\nThis re-runs the commission formula for every project that completed this month using the current config values.\n\nAlready-PAID rows are skipped.`
                      )
                    )
                      e.preventDefault();
                  }}
                >
                  <input type="hidden" name="monthKey" value={selected} />
                  <button className="rounded-xl border border-sky-400 text-sky-700 bg-sky-50 px-4 py-2 text-sm hover:bg-sky-100 transition-colors">
                    Recalculate
                  </button>
                </form>
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
    </div>
  );
}