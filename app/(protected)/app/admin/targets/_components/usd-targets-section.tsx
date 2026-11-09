// Server component: BD USD targets for the STUDIO cost model.
import { saveUsdTargets } from "../studio-actions";
import type { UsdTargetEditorData } from "@/lib/studio/targets";

const inputCls = "w-full rounded-xl border bg-background px-3 py-2 text-sm";

function usd(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export function UsdTargetsSection({
  data,
  usesStudio,
}: {
  data: UsdTargetEditorData;
  usesStudio: boolean;
}) {
  const { rows, savedTotalUsd, expensesPkr, kPkrPerUsd } = data;

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">BD targets (USD) — {data.monthKey}</div>
          <p className="text-xs text-muted-foreground">
            STUDIO model. Each BD&apos;s share of the month&apos;s expenses = their target ÷ all targets. Hitting
            target covers that share; the unsold part of a missed target is still charged. Include the System
            BD — it carries your own sales.
          </p>
        </div>
        <div className="text-right shrink-0 text-xs space-y-0.5">
          <div>
            Expenses: <strong>{expensesPkr.toLocaleString()} PKR</strong>
          </div>
          <div>
            Suggested total (2× ÷ FX):{" "}
            <strong>{data.fx > 0 ? usd(data.suggestedTotalUsd) : "set FX"}</strong>
          </div>
          <div>
            Saved total: <strong>{usd(savedTotalUsd)}</strong>
          </div>
          {kPkrPerUsd > 0 ? (
            <div className="text-muted-foreground">
              Expense per target $: <strong>{kPkrPerUsd.toLocaleString()} PKR</strong>
            </div>
          ) : null}
        </div>
      </div>

      {!usesStudio ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {data.monthKey} runs on the STAFF model. USD targets are saved but only used once a STUDIO change
          covers this month (Finance Config → Cost Model).
        </div>
      ) : null}

      {data.copiedFrom ? (
        <div className="text-[11px] text-muted-foreground">
          Prefilled from {data.copiedFrom} — not saved until you click Save.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No active business developers.</div>
      ) : (
        <form action={saveUsdTargets} className="space-y-3">
          <input type="hidden" name="monthKey" value={data.monthKey} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-medium">BD</th>
                  <th className="py-1 pr-3 font-medium">Avg sales (last 3 mo)</th>
                  <th className="py-1 pr-3 font-medium">Suggested</th>
                  <th className="py-1 pr-3 font-medium w-40">Target (USD)</th>
                  <th className="py-1 font-medium">Expense share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const share =
                    r.savedUsd != null && savedTotalUsd > 0 ? (expensesPkr * r.savedUsd) / savedTotalUsd : null;
                  return (
                    <tr key={r.bdId} className="border-t">
                      <td className="py-2 pr-3">
                        {r.name}
                        {r.isSystem ? <span className="ml-1 text-[11px] text-muted-foreground">(System)</span> : null}
                      </td>
                      <td className="py-2 pr-3">{usd(r.avg3mUsd)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {data.fx > 0 ? usd(data.suggestedPerBdUsd) : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          name={`target_${r.bdId}`}
                          inputMode="decimal"
                          defaultValue={r.defaultUsd ?? ""}
                          placeholder="e.g. 800"
                          className={inputCls}
                        />
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {share != null ? `${Math.round(share).toLocaleString()} PKR` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground">
              Blank = no target for that BD this month. Expense share updates after saving.
            </div>
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-muted">Save targets</button>
          </div>
        </form>
      )}
    </div>
  );
}
