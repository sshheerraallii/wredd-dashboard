// app/(protected)/app/performance/_components/employee-projects-table.tsx
import Link from "next/link";
import { CommitmentBadge } from "@/components/app/commitment-index";
import type { CommitmentIndex } from "@/lib/worker-stats/commitment-index";

export function EmployeeProjectsTable({
  kind,
  rows,
  commitmentIndex,
}: {
  kind: "onsite" | "remote";
  rows: Array<{
    id: string;
    title: string;
    status: string;
    ratingAvg: number | null;
    points: number | null;
    paidAmount: string | null;
    unpaidAmount: string | null;
  }>;
  /** Pass the computed CommitmentIndex for this worker (from server) */
  commitmentIndex?: CommitmentIndex;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">

      {/* Commitment badge row — shown if index was passed */}
      {commitmentIndex && (
        <div className="flex items-center justify-between gap-3 pb-3 border-b">
          <div className="text-sm font-medium">Projects</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Commitment Index</span>
            <CommitmentBadge index={commitmentIndex} />
          </div>
        </div>
      )}

      {!commitmentIndex && (
        <div className="text-sm font-medium">Projects</div>
      )}

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
                <th className="py-2 text-right">Payment</th>
              )}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="py-4 text-muted-foreground" colSpan={4}>
                  No projects in this scope.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="py-2">
                    <Link className="underline" href={`/app/projects/${r.id}`}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-2">{r.status}</td>
                  <td className="py-2 text-right">
                    {r.ratingAvg != null ? r.ratingAvg.toFixed(1) : "—"}
                  </td>

                  {kind === "onsite" ? (
                    <td className="py-2 text-right">{r.points ?? 0}</td>
                  ) : (
                    <td className="py-2 text-right">
                      Paid {r.paidAmount ?? "0"} • Unpaid {r.unpaidAmount ?? "0"}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}