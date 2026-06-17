// components/bd-targets/ui.tsx
import type { DeptResult, BdResult, SignalSet, Buckets } from "@/lib/bd-targets/compute";

function fmtUsd(n: number): string {
  return `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function fmtPkr(usd: number, fx: number): string | null {
  if (!fx || fx <= 0) return null;
  const pkr = Math.round(usd * fx);
  return `₨${pkr.toLocaleString("en-US")}`;
}

export function Money({ usd, fx, className }: { usd: number; fx: number; className?: string }) {
  const pkr = fmtPkr(usd, fx);
  return (
    <span className={className}>
      {fmtUsd(usd)}
      {pkr ? <span className="text-muted-foreground"> ({pkr})</span> : null}
    </span>
  );
}

function StockLine({ s }: { s: SignalSet }) {
  if (s.targetSecured) {
    const surplus = Math.max(0, -s.gapUsd);
    return (
      <div className="text-sm text-emerald-700">
        Target secured{surplus > 0 ? ` — surplus ${fmtUsd(surplus)} is bonus` : ""}.
      </div>
    );
  }
  return <div className="text-sm text-[#8F4043] font-medium">Still to develop: {fmtUsd(s.gapUsd)}</div>;
}

function FlowLine({ s }: { s: SignalSet }) {
  if (s.dailyRateUsd <= 0) {
    return <div className="text-xs text-muted-foreground">Set a target & working days to compute runway.</div>;
  }
  if (s.shortRunway) {
    return (
      <div className="text-xs text-amber-700">
        Pipeline feeds the team ~{s.runwayDays} working day{s.runwayDays === 1 ? "" : "s"}, then idle
        {" "}({s.daysRemaining} remaining this month).
      </div>
    );
  }
  return (
    <div className="text-xs text-sky-700">
      Fed through month-end{s.surplusUsd > 0 ? ` — route ${fmtUsd(s.surplusUsd)} to remote workers` : ""}.
    </div>
  );
}

function BucketRow({ label, usd, fx, hint }: { label: string; usd: number; fx: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 text-[10px] text-amber-600">{hint}</span> : null}
      </span>
      <Money usd={usd} fx={fx} className="text-sm tabular-nums" />
    </div>
  );
}

export function DeptCard({ dept, fx }: { dept: DeptResult; fx: number }) {
  const b = dept.buckets;
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{dept.name}</h3>
        <span className="text-[11px] text-muted-foreground">
          {dept.capacityPoints} pts × $6
          {dept.workingDaysAssumed ? " · days≈25" : ` · ${dept.workingDays}d`}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Target</span>
        <Money usd={dept.targetUsd} fx={fx} className="text-base font-semibold tabular-nums" />
      </div>
      <div className="h-px bg-border" />
      <div>
        <BucketRow label="Achieved" usd={b.achievedUsd} fx={fx} />
        <BucketRow label="Active" usd={b.activeUsd} fx={fx} hint="depletes as work completes" />
        <BucketRow label="Backlog (unassigned)" usd={b.backlogUsd} fx={fx} />
      </div>
      <div className="h-px bg-border" />
      <StockLine s={dept.signals} />
      <FlowLine s={dept.signals} />
    </div>
  );
}

export function Headline({
  totals,
  fx,
}: {
  totals: { targetUsd: number; achievedUsd: number; activeUsd: number; backlogUsd: number; gapUsd: number };
  fx: number;
}) {
  const cells: { label: string; usd: number; tone?: string }[] = [
    { label: "Target", usd: totals.targetUsd },
    { label: "Achieved", usd: totals.achievedUsd, tone: "text-emerald-700" },
    { label: "Active", usd: totals.activeUsd, tone: "text-sky-700" },
    { label: "Backlog", usd: totals.backlogUsd, tone: "text-slate-700" },
    { label: "Gap (not in system)", usd: totals.gapUsd, tone: totals.gapUsd > 0.01 ? "text-[#8F4043]" : "text-emerald-700" },
  ];
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <Money usd={c.usd} fx={fx} className={["text-lg font-semibold tabular-nums", c.tone ?? ""].join(" ")} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BdTable({ bds, fx }: { bds: BdResult[]; fx: number }) {
  return (
    <div className="rounded-2xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              <th className="p-3">BD</th>
              <th className="p-3">Dept</th>
              <th className="p-3 text-right">Target</th>
              <th className="p-3 text-right">Covered</th>
              <th className="p-3 text-right">Gap</th>
              <th className="p-3">Runway</th>
            </tr>
          </thead>
          <tbody>
            {bds.flatMap((bd) =>
              bd.perDept.map((d, i) => (
                <tr key={`${bd.bdId}:${d.key}`} className="border-t align-top">
                  {i === 0 ? (
                    <td className="p-3" rowSpan={bd.perDept.length}>
                      {bd.name}
                      {bd.isSystem ? (
                        <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          System
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="p-3">
                    {d.name} <span className="text-[11px] text-muted-foreground">({d.allocationPct}%)</span>
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <Money usd={d.targetUsd} fx={fx} />
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <Money usd={d.signals.coveredUsd} fx={fx} />
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <span className={d.signals.gapUsd > 0.01 ? "text-[#8F4043]" : "text-emerald-700"}>
                      <Money usd={d.signals.gapUsd} fx={fx} />
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {d.signals.dailyRateUsd <= 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : d.signals.shortRunway ? (
                      <span className="text-amber-700">~{d.signals.runwayDays}d, idle after</span>
                    ) : (
                      <span className="text-sky-700">
                        through month{d.signals.surplusUsd > 0 ? ` · +${fmtUsd(d.signals.surplusUsd)} remote` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { DeptResult, BdResult, Buckets };

export function BdDeptCard({ slice, fx }: { slice: BdResult["perDept"][number]; fx: number }) {
  const b = slice.buckets;
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{slice.name}</h3>
        <span className="text-[11px] text-muted-foreground">your share {slice.allocationPct}%</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Your target</span>
        <Money usd={slice.targetUsd} fx={fx} className="text-base font-semibold tabular-nums" />
      </div>
      <div className="h-px bg-border" />
      <div>
        <BucketRow label="Achieved" usd={b.achievedUsd} fx={fx} />
        <BucketRow label="Active" usd={b.activeUsd} fx={fx} hint="depletes as work completes" />
        <BucketRow label="Backlog (unassigned)" usd={b.backlogUsd} fx={fx} />
      </div>
      <div className="h-px bg-border" />
      <StockLine s={slice.signals} />
      <FlowLine s={slice.signals} />
    </div>
  );
}

export type SnapshotRow = {
  monthKey: string;
  departmentName: string;
  targetUsd: number;
  achievedUsd: number;
  snapshotAt: string; // ISO
};

export function SnapshotHistory({ rows, fx }: { rows: SnapshotRow[]; fx: number }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
        No snapshots yet. Use “Snapshot this month” to freeze a month&apos;s target and achieved.
      </div>
    );
  }
  // Group by month (rows already sorted month desc, dept asc).
  const months: string[] = [];
  for (const r of rows) if (!months.includes(r.monthKey)) months.push(r.monthKey);

  return (
    <div className="rounded-2xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              <th className="p-3">Month</th>
              <th className="p-3">Department</th>
              <th className="p-3 text-right">Target</th>
              <th className="p-3 text-right">Achieved</th>
              <th className="p-3 text-right">% hit</th>
            </tr>
          </thead>
          <tbody>
            {months.flatMap((mk) => {
              const group = rows.filter((r) => r.monthKey === mk);
              return group.map((r, i) => {
                const pct = r.targetUsd > 0 ? Math.round((r.achievedUsd / r.targetUsd) * 100) : null;
                return (
                  <tr key={`${mk}:${r.departmentName}`} className="border-t align-top">
                    {i === 0 ? (
                      <td className="p-3 font-medium" rowSpan={group.length}>
                        {mk}
                      </td>
                    ) : null}
                    <td className="p-3">{r.departmentName}</td>
                    <td className="p-3 text-right tabular-nums">
                      <Money usd={r.targetUsd} fx={fx} />
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      <Money usd={r.achievedUsd} fx={fx} />
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {pct == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={pct >= 100 ? "text-emerald-700" : "text-[#8F4043]"}>{pct}%</span>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
