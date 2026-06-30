// app/(protected)/app/admin/targets/_components/allocation-editor.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { saveAllocations } from "../actions";

type Dept = { id: string; name: string };
type Bd = { id: string; name: string; isSystem: boolean };

export type AllocationEditorProps = {
  monthKey: string;
  departments: Dept[];
  bds: Bd[];
  /** key: `${bdId}:${deptId}` -> percent (0..100) */
  initial: Record<string, number>;
  /** true when values were pre-filled from a prior month (not yet saved) */
  copiedFrom?: string | null;
};

const TOL = 0.01;

export default function AllocationEditor({
  monthKey,
  departments,
  bds,
  initial,
  copiedFrom,
}: AllocationEditorProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const bd of bds) {
      for (const d of departments) {
        const k = `${bd.id}:${d.id}`;
        seed[k] = Number.isFinite(initial[k]) ? initial[k] : 0;
      }
    }
    return seed;
  });

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const d of departments) {
      let sum = 0;
      for (const bd of bds) sum += values[`${bd.id}:${d.id}`] ?? 0;
      t[d.id] = Math.round(sum * 100) / 100;
    }
    return t;
  }, [values, departments, bds]);

  const allValid = departments.every((d) => Math.abs((totals[d.id] ?? 0) - 100) <= TOL);

  const payload = useMemo(() => {
    const rows: { bdId: string; departmentId: string; sharePercent: number }[] = [];
    for (const bd of bds) {
      for (const d of departments) {
        rows.push({ bdId: bd.id, departmentId: d.id, sharePercent: values[`${bd.id}:${d.id}`] ?? 0 });
      }
    }
    return JSON.stringify(rows);
  }, [values, bds, departments]);

  function setVal(bdId: string, deptId: string, raw: string) {
    const n = raw === "" ? 0 : Number(raw);
    setValues((prev) => ({ ...prev, [`${bdId}:${deptId}`]: Number.isFinite(n) ? n : 0 }));
  }

  function distributeEven(deptId: string) {
    const n = bds.length;
    if (n === 0) return;
    const each = Math.floor((100 / n) * 100) / 100;
    const remainder = Math.round((100 - each * n) * 100) / 100;
    setValues((prev) => {
      const next = { ...prev };
      bds.forEach((bd, i) => {
        next[`${bd.id}:${deptId}`] = i === 0 ? Math.round((each + remainder) * 100) / 100 : each;
      });
      return next;
    });
  }

  const [pending, start] = useTransition();

  return (
    <form
      action={(fd: FormData) => start(async () => { await saveAllocations(fd); })}
      className="space-y-4"
    >
      <input type="hidden" name="monthKey" value={monthKey} />
      <input type="hidden" name="payload" value={payload} />

      {copiedFrom ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Pre-filled from {copiedFrom} (not yet saved). Review and Save to apply to {monthKey}.
        </div>
      ) : null}

      <div className="rounded-2xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-3">Business Developer</th>
                {departments.map((d) => (
                  <th key={d.id} className="p-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>{d.name} (%)</span>
                      <button
                        type="button"
                        onClick={() => distributeEven(d.id)}
                        className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-background"
                        title="Split evenly across all BDs"
                      >
                        even
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bds.map((bd) => (
                <tr key={bd.id} className="border-t">
                  <td className="p-3">
                    {bd.name}
                    {bd.isSystem ? (
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        System BD
                      </span>
                    ) : null}
                  </td>
                  {departments.map((d) => (
                    <td key={d.id} className="p-3">
                      <input
                        inputMode="decimal"
                        value={values[`${bd.id}:${d.id}`] ?? 0}
                        onChange={(e) => setVal(bd.id, d.id, e.target.value)}
                        className="w-24 rounded-lg border bg-background px-2 py-1 text-sm"
                        disabled={pending}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40">
                <td className="p-3 font-medium">Total</td>
                {departments.map((d) => {
                  const t = totals[d.id] ?? 0;
                  const ok = Math.abs(t - 100) <= TOL;
                  return (
                    <td key={d.id} className="p-3">
                      <span
                        className={[
                          "rounded-md px-2 py-0.5 text-xs font-medium",
                          ok ? "bg-emerald-100 text-emerald-700" : "bg-destructive/10 text-destructive",
                        ].join(" ")}
                      >
                        {t.toFixed(2)}%
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!allValid || pending}
          className={[
            "rounded-xl px-4 py-2 text-sm font-medium text-white",
            allValid ? "bg-[#8F4043] hover:opacity-90" : "bg-muted-foreground/40 cursor-not-allowed",
          ].join(" ")}
        >
          {pending ? "Saving…" : "Save allocations"}
        </button>
        {!allValid ? (
          <span className="text-xs text-muted-foreground">Each department column must total exactly 100%.</span>
        ) : null}
      </div>
    </form>
  );
}
