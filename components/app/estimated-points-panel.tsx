// components/app/estimated-points-panel.tsx
//
// Presentational panel for the ESTIMATED (live, subject-to-change) onsite points
// layer. Pure/server-safe — takes a precomputed summary and renders it.

import type { UserEstimatedSummary, EstimatedLine } from "@/lib/onsite-points/aggregate";

function factorLabel(line: EstimatedLine): string {
  if (line.status === "DELIVERED") return "Delivered · 100%";
  if (line.stateFactor === 0.7) return "In revision · 70%";
  if (line.status === "REVISION") return "In revision · 70%";
  return "In progress · 30%";
}

function statusTone(line: EstimatedLine): string {
  if (line.status === "DELIVERED") return "text-emerald-700 dark:text-emerald-400";
  if (line.stateFactor === 0.7 || line.status === "REVISION")
    return "text-amber-700 dark:text-amber-400";
  return "text-sky-700 dark:text-sky-400";
}

function ptsLabel(line: EstimatedLine): string {
  if (!line.computable) return "—";
  if (line.estimatedPoints === 0) return "<1 pt";
  return `${line.estimatedPoints} pt${line.estimatedPoints === 1 ? "" : "s"}`;
}

export function EstimatedPointsPanel({
  summary,
  title = "Estimated Points (live)",
  compact = false,
}: {
  summary: UserEstimatedSummary;
  title?: string;
  compact?: boolean;
}) {
  const { lines, totalEstimatedPoints, fxMissing } = summary;
  const activeCount = lines.length;

  return (
    <div className="rounded-xl border border-dashed bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            Subject to change · finalizes when each project completes
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold leading-none">
            {totalEstimatedPoints}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            from {activeCount} active project{activeCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {fxMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          No FX rate is set for this month yet, so these estimates are approximate.
        </div>
      )}

      {activeCount === 0 ? (
        <div className="text-xs text-muted-foreground">
          No active projects right now.
        </div>
      ) : compact ? null : (
        <div className="space-y-1.5">
          {lines.map((line) => (
            <div
              key={line.projectId}
              className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{line.title}</div>
                <div className={`text-[11px] ${statusTone(line)}`}>
                  {factorLabel(line)}
                  {line.allocatedHours != null
                    ? ` · ${line.allocatedHours}h allocated`
                    : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{ptsLabel(line)}</div>
                {line.computable && line.basePoints > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    of {line.basePoints} full
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
