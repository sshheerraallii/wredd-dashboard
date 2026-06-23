// app/(protected)/app/bd/targets/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { requireRole } from "@/lib/guards";
import { computeTargets } from "@/lib/bd-targets/compute";
import { Headline, DeptCard, BdTable, BdDeptCard } from "@/components/bd-targets/ui";

function nowMonthKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function BdTargetsViewPage({
  searchParams,
}: {
  searchParams: { monthKey?: string };
}) {
  const user = await requireRole(["BUSINESS_DEVELOPER", "MANAGER"]);
  const role = (user?.role as string) ?? "";
  const selected = searchParams.monthKey ?? nowMonthKeyUTC();

  const comp = await computeTargets(selected);

  const seesAll = role === "MANAGER" || role === "SUPER_ADMIN";
  const fxNote =
    comp.fxAssumed && comp.fxMonthKey ? `FX from ${comp.fxMonthKey}` : comp.fx > 0 ? "Live FX" : "No FX set";

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Targets</h1>
          <p className="text-sm text-muted-foreground">
            {seesAll ? "Team-wide onsite capacity targets and runway." : "Your onsite capacity target and runway."}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {selected} · {fxNote}
        </span>
      </div>

      {!comp.setupComplete ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Targets aren&apos;t set up yet. Ask an admin to configure the Animations and Video Editing departments.
        </div>
      ) : seesAll ? (
        // Manager (and Super Admin) — full read-only overview.
        <div className="space-y-4">
          <Headline totals={comp.totals} fx={comp.fx} />
          <div className="grid gap-4 sm:grid-cols-2">
            {comp.departments.map((d) => (
              <DeptCard key={d.key} dept={d} fx={comp.fx} />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">By Business Developer</h3>
            <BdTable bds={comp.bds} fx={comp.fx} />
          </div>
        </div>
      ) : (
        // Business Developer — own slice only.
        (() => {
          const me = comp.bds.find((b) => b.bdId === (user?.id as string));
          if (!me) {
            return (
              <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                No target allocation found for your account this month.
              </div>
            );
          }
          return (
            <div className="space-y-4">
              <div className="rounded-2xl border bg-card p-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Your target</div>
                    <div className="text-lg font-semibold tabular-nums">
                      ${me.totalTargetUsd.toLocaleString("en-US")}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Covered</div>
                    <div className="text-lg font-semibold tabular-nums text-emerald-700">
                      ${me.totalCoveredUsd.toLocaleString("en-US")}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Gap</div>
                    <div
                      className={[
                        "text-lg font-semibold tabular-nums",
                        me.totalGapUsd > 0.01 ? "text-[#8F4043]" : "text-emerald-700",
                      ].join(" ")}
                    >
                      ${me.totalGapUsd.toLocaleString("en-US")}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {me.perDept.map((d) => (
                  <BdDeptCard key={d.key} slice={d} fx={comp.fx} />
                ))}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
