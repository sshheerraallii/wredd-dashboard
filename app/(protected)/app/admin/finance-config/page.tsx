// app/(protected)/app/admin/finance-config/page.tsx
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { createMonth, finalizeMonth, updateMonth } from "./actions";

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
  searchParams: { monthKey?: string; err?: string; ok?: string };
}) {
  const { user } = await readSession();
  requireSuperAdmin(user?.role);

  const all = await prisma.monthlyFinanceConfig.findMany({
    orderBy: { monthKey: "desc" },
  });

  const selected = searchParams.monthKey ?? all[0]?.monthKey ?? nowMonthKeyUTC();
  const row = all.find((x) => x.monthKey === selected) ?? null;

  const err = searchParams.err ? decodeURIComponent(searchParams.err) : null;
  const ok = searchParams.ok ? "Saved." : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Monthly Finance Config</h1>
        <p className="text-sm text-muted-foreground">
          Create a month, edit values, then finalize to lock server-side.
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {ok ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {ok}
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Selected month</div>
              <div className="text-lg font-semibold">{selected}</div>
              <div className="text-xs text-muted-foreground">
                Status:{" "}
                {row?.finalizedAt ? (
                  <span className="text-emerald-700">Finalized (locked)</span>
                ) : (
                  <span>Draft (editable)</span>
                )}
              </div>
            </div>

            {row && !row.finalizedAt ? (
              <form action={finalizeMonth}>
                <input type="hidden" name="monthKey" value={selected} />
                <button className="rounded-xl bg-black text-white px-4 py-2 text-sm hover:opacity-90">
                  Finalize (Lock)
                </button>
              </form>
            ) : null}
          </div>

          {!row ? (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              This month doesn’t exist yet. Use “Create / open month” to create it.
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
                    disabled={!!row.finalizedAt}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="e.g. 280.0000"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Avg Onsite Hour Cost (PKR)</label>
                  <input
                    name="avgOnsiteHourCostPkr"
                    defaultValue={row.avgOnsiteHourCostPkr ?? ""}
                    disabled={!!row.finalizedAt}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="e.g. 1500"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">Remote Overhead Fixed (PKR)</label>
                  <input
                    name="remoteOverheadFixedPkr"
                    defaultValue={row.remoteOverheadFixedPkr ?? ""}
                    disabled={!!row.finalizedAt}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="e.g. 250000"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">Notes</label>
                  <textarea
                    name="notes"
                    defaultValue={safeStr(row.notes ?? "")}
                    disabled={!!row.finalizedAt}
                    className="min-h-[90px] w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    placeholder="Optional notes..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {row.finalizedAt ? "This month is locked and cannot be edited." : "Edits allowed until finalized."}
                </div>

                <button
                  disabled={!!row.finalizedAt}
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