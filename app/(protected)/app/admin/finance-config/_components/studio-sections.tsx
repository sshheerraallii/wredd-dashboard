// Server components: cost-model log + monthly expense ledger.
import {
  addCostModelChange,
  addExpense,
  copyRecurringExpenses,
  deleteCostModelChange,
  deleteExpense,
  updateExpense,
} from "../studio-actions";
import {
  EXPENSE_CATEGORIES,
  type CostModelChangeRow,
  type CostModelName,
  type MonthSegment,
} from "@/lib/studio/cost-model";

const inputCls = "w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60";

function fmtPkr(n: number) {
  return `${Math.round(n).toLocaleString()} PKR`;
}

function d10(d: Date) {
  return d.toISOString().slice(0, 10);
}

function ModelBadge({ model }: { model: CostModelName }) {
  return (
    <span
      className={[
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
        model === "STUDIO" ? "border-primary/40 text-primary" : "text-muted-foreground",
      ].join(" ")}
    >
      {model}
    </span>
  );
}

export function CostModelSection({
  monthKey,
  changes,
  currentModel,
  segments,
}: {
  monthKey: string;
  changes: CostModelChangeRow[];
  currentModel: CostModelName;
  segments: MonthSegment[];
}) {
  const today = d10(new Date());

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div>
        <div className="text-sm font-medium">Cost Model (Global)</div>
        <p className="text-xs text-muted-foreground">
          <strong>STAFF</strong> = onsite salaries + overhead pool, BD load by department allocation %.{" "}
          <strong>STUDIO</strong> = expense ledger below + BD targets in USD. Each change applies from its
          date onward; a month that crosses a change is settled in parts. With no changes, everything is STAFF.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          In force today: <ModelBadge model={currentModel} />
        </span>
        <span className="text-muted-foreground">
          {monthKey}:{" "}
          {segments.map((s, i) => (
            <span key={i} className="mr-2">
              <ModelBadge model={s.model} /> {d10(s.from)} → {d10(new Date(s.to.getTime() - 86400000))}
            </span>
          ))}
        </span>
      </div>

      {changes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-medium">From</th>
                <th className="py-1 pr-3 font-medium">Model</th>
                <th className="py-1 pr-3 font-medium">Note</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2 pr-3 whitespace-nowrap">{d10(c.effectiveFrom)}</td>
                  <td className="py-2 pr-3">
                    <ModelBadge model={c.model} />
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{c.note ?? ""}</td>
                  <td className="py-2 text-right">
                    <form action={deleteCostModelChange}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="monthKey" value={monthKey} />
                      <button className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <form action={addCostModelChange} className="grid gap-3 md:grid-cols-[160px_140px_1fr_auto] items-end">
        <input type="hidden" name="monthKey" value={monthKey} />
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Effective from</label>
          <input name="effectiveFrom" type="date" defaultValue={today} className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Model</label>
          <select name="model" defaultValue="STUDIO" className={inputCls}>
            <option value="STUDIO">STUDIO</option>
            <option value="STAFF">STAFF</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Note (optional)</label>
          <input name="note" maxLength={500} placeholder="e.g. staff zero, AI production" className={inputCls} />
        </div>
        <button className="rounded-xl border px-4 py-2 text-sm hover:bg-muted">Add change</button>
      </form>
    </div>
  );
}

export type ExpenseRowView = {
  id: string;
  category: string;
  label: string;
  amountPkr: number;
  recurring: boolean;
};

export function ExpenseLedgerSection({
  monthKey,
  rows,
  locked,
  fx,
  usesStudio,
}: {
  monthKey: string;
  rows: ExpenseRowView[];
  locked: boolean;
  fx: number;
  usesStudio: boolean;
}) {
  const total = rows.reduce((a, r) => a + r.amountPkr, 0);

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Expenses — {monthKey}</div>
          <p className="text-xs text-muted-foreground">
            Everything the studio pays this month: rent, each bill, each AI subscription, any salary. Not
            remote payouts, platform fees, BD commission or owner drawings. Tick <em>Recurring</em> on fixed
            lines and they copy into the next month.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-lg font-semibold">{fmtPkr(total)}</div>
          {fx > 0 ? (
            <div className="text-[11px] text-muted-foreground">
              ≈ ${Math.round(total / fx).toLocaleString()} · suggested company target (2×) ≈ $
              {Math.round((2 * total) / fx).toLocaleString()}
            </div>
          ) : (
            <div className="text-[11px] text-amber-700">Set the FX rate to see USD.</div>
          )}
        </div>
      </div>

      {!usesStudio ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {monthKey} runs on the STAFF model, so these lines are recorded but not used in settlement. Add a
          STUDIO change in Cost Model to use them.
        </div>
      ) : null}

      {locked ? (
        <div className="text-xs text-muted-foreground">Month is finalized — unfinalize to edit expenses.</div>
      ) : null}

      {rows.length === 0 && !locked ? (
        <form action={copyRecurringExpenses}>
          <input type="hidden" name="monthKey" value={monthKey} />
          <button className="rounded-xl border px-3 py-2 text-sm hover:bg-muted">
            Copy recurring lines from the previous month
          </button>
        </form>
      ) : null}

      {rows.length > 0 ? (
        <div className="space-y-2">
          <div className="hidden md:grid md:grid-cols-[150px_1fr_140px_90px_auto] gap-2 text-[11px] text-muted-foreground px-1">
            <span>Category</span>
            <span>Label</span>
            <span>Amount (PKR)</span>
            <span>Recurring</span>
            <span />
          </div>
          {rows.map((r) => (
            <form
              key={r.id}
              action={updateExpense}
              className="grid gap-2 md:grid-cols-[150px_1fr_140px_90px_auto] items-center"
            >
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="monthKey" value={monthKey} />
              <select name="category" defaultValue={r.category} disabled={locked} className={inputCls}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input name="label" defaultValue={r.label} disabled={locked} className={inputCls} />
              <input
                name="amountPkr"
                inputMode="numeric"
                defaultValue={r.amountPkr}
                disabled={locked}
                className={inputCls}
              />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="recurring" defaultChecked={r.recurring} disabled={locked} />
                Recurring
              </label>
              {locked ? (
                <span />
              ) : (
                <div className="flex gap-2">
                  <button className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">Save</button>
                  <button formAction={deleteExpense} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                    Delete
                  </button>
                </div>
              )}
            </form>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No expense lines for {monthKey} yet.</div>
      )}

      {!locked ? (
        <form
          action={addExpense}
          className="grid gap-2 md:grid-cols-[150px_1fr_140px_90px_auto] items-end border-t pt-4"
        >
          <input type="hidden" name="monthKey" value={monthKey} />
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <select name="category" defaultValue="BILLS" className={inputCls}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Label</label>
            <input name="label" placeholder="e.g. Office rent, Electricity, Claude Max" className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Amount (PKR)</label>
            <input name="amountPkr" inputMode="numeric" placeholder="e.g. 80000" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-xs pb-2">
            <input type="checkbox" name="recurring" />
            Recurring
          </label>
          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-muted">Add line</button>
        </form>
      ) : null}
    </div>
  );
}
