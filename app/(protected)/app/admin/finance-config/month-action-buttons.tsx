// app/(protected)/app/admin/finance-config/month-action-buttons.tsx
"use client";

import { unfinalizeMonth, recalculateMonth } from "./actions";

export function UnfinalizeButton({ monthKey }: { monthKey: string }) {
  return (
    <form
      action={unfinalizeMonth}
      onSubmit={(e) => {
        if (!confirm(`Unlock ${monthKey}? You can edit values and re-finalize after.`))
          e.preventDefault();
      }}
    >
      <input type="hidden" name="monthKey" value={monthKey} />
      <button className="rounded-xl border border-amber-400 text-amber-700 bg-amber-50 px-4 py-2 text-sm hover:bg-amber-100 transition-colors">
        Unfinalize (Unlock)
      </button>
    </form>
  );
}

export function RecalculateButton({ monthKey }: { monthKey: string }) {
  return (
    <form
      action={recalculateMonth}
      onSubmit={(e) => {
        if (
          !confirm(
            `Recalculate all BD commission rows for ${monthKey}?\n\nThis re-runs the commission formula for every project that completed this month using the current config values.\n\nAlready-PAID rows are skipped.`
          )
        )
          e.preventDefault();
      }}
    >
      <input type="hidden" name="monthKey" value={monthKey} />
      <button className="rounded-xl border border-sky-400 text-sky-700 bg-sky-50 px-4 py-2 text-sm hover:bg-sky-100 transition-colors">
        Recalculate
      </button>
    </form>
  );
}