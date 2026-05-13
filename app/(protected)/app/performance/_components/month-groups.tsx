import Link from "next/link";

export type MonthProjectRow = {
  id: string;
  title: string;
  status: string;
  ratingAvg: number | null;
  points?: number | null;
  paidAmount?: string | null;
  unpaidAmount?: string | null;
};

export type MonthGroup = {
  monthKey: string;
  summaryRight?: string; // e.g. "Points 88 • Target 120 • Acc 73%"
  rows: MonthProjectRow[];
};

export function MonthGroups(props: {
  groups: MonthGroup[];
  kind: "onsite" | "remote";
}) {
  const { groups, kind } = props;

  if (!groups.length) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        No months in this range.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <details key={g.monthKey} className="rounded-xl border bg-card">
          <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
            <div className="font-medium">{g.monthKey}</div>
            <div className="text-xs text-muted-foreground">
              {g.summaryRight || `${g.rows.length} projects`}
            </div>
          </summary>

          <div className="border-t px-4 py-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left">Project</th>
                    <th className="py-2 text-left">Status</th>
                    <th className="py-2 text-right">Rating</th>
                    {kind === "onsite" ? (
                      <th className="py-2 text-right">Points</th>
                    ) : (
                      <>
                        <th className="py-2 text-right">Paid</th>
                        <th className="py-2 text-right">Unpaid</th>
                      </>
                    )}
                    <th className="py-2 text-right">Open</th>
                  </tr>
                </thead>

                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2">{r.title}</td>
                      <td className="py-2">{r.status}</td>
                      <td className="py-2 text-right">
                        {r.ratingAvg != null ? r.ratingAvg.toFixed(1) : "—"}
                      </td>

                      {kind === "onsite" ? (
                        <td className="py-2 text-right">{r.points ?? 0}</td>
                      ) : (
                        <>
                          <td className="py-2 text-right">{r.paidAmount ?? "0"}</td>
                          <td className="py-2 text-right">{r.unpaidAmount ?? "0"}</td>
                        </>
                      )}

                      <td className="py-2 text-right">
                        <Link className="underline" href={`/app/projects/${r.id}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {!g.rows.length ? (
                    <tr>
                      <td colSpan={kind === "onsite" ? 5 : 6} className="py-6 text-center text-muted-foreground">
                        No projects in this month.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
