"use client";

// components/app/commitment-index.tsx

import * as React from "react";
import type { CommitmentIndex, CommitmentLabel } from "@/lib/worker-stats/commitment-index";
import {
  COMMITMENT_COLORS,
  COMMITMENT_DESCRIPTIONS,
  SIGNAL_LABELS,
  MIN_ASSIGNMENTS_FOR_SCORE,
} from "@/lib/worker-stats/commitment-index";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 90 ? "#639922" :
    score >= 75 ? "#378ADD" :
    score >= 60 ? "#BA7517" :
                  "#E24B4A";

  return (
    <div className="relative h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
      <div
        className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommitmentBadge — small inline badge, used in summary tables
// ─────────────────────────────────────────────────────────────────────────────

export function CommitmentBadge({
  index,
  showScore = true,
}: {
  index: CommitmentIndex;
  showScore?: boolean;
}) {
  const colors = COMMITMENT_COLORS[index.label];

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border",
        colors.bg,
        colors.text,
        colors.border,
      ].join(" ")}
    >
      {showScore && index.score !== null && (
        <span className="font-semibold tabular-nums">{index.score}</span>
      )}
      <span>{index.label}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommitmentIndexCard — full breakdown card, used on performance pages
// ─────────────────────────────────────────────────────────────────────────────

export function CommitmentIndexCard({
  index,
  workerName,
  showCancellationDetail = true,
}: {
  index: CommitmentIndex;
  workerName?: string;
  showCancellationDetail?: boolean;
}) {
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const colors = COMMITMENT_COLORS[index.label];

  const signalEntries = [
    { key: "completion" as const, label: SIGNAL_LABELS.completion },
    { key: "onTime"     as const, label: SIGNAL_LABELS.onTime     },
    { key: "revision"   as const, label: SIGNAL_LABELS.revision   },
    { key: "rating"     as const, label: SIGNAL_LABELS.rating     },
  ];

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-muted-foreground">
            Commitment Index{workerName ? ` · ${workerName}` : ""}
          </div>

          <div className="mt-2 flex items-end gap-3">
            {/* Score ring */}
            <div
              className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border-2 text-2xl font-semibold tabular-nums"
              style={{
                borderColor: index.isUnrated ? "#B4B2A9" : colors.hex,
                color      : index.isUnrated ? "#888780" : colors.hex,
              }}
            >
              {index.score ?? "—"}
            </div>

            <div>
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium",
                  colors.bg,
                  colors.text,
                  colors.border,
                ].join(" ")}
              >
                {index.label}
              </span>
              <div className="mt-1 text-xs text-muted-foreground max-w-xs">
                {COMMITMENT_DESCRIPTIONS[index.label]}
              </div>
            </div>
          </div>

          {/* Score bar */}
          {!index.isUnrated && index.score !== null && (
            <div className="mt-3 w-48">
              <ScoreBar score={index.score} />
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>50</span><span>100</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right text-sm shrink-0">
          <div className="text-muted-foreground text-xs col-span-2 text-left">Overview</div>

          <div className="text-muted-foreground text-xs">Concluded</div>
          <div className="font-medium tabular-nums">{index.totalConcluded}</div>

          <div className="text-muted-foreground text-xs">Completed</div>
          <div className="font-medium tabular-nums text-green-700 dark:text-green-400">
            {index.completed}
          </div>

          <div className="text-muted-foreground text-xs">Cancellation rate</div>
          <div
            className={[
              "font-medium tabular-nums",
              index.cancellationRate > 0.3
                ? "text-red-600 dark:text-red-400"
                : index.cancellationRate > 0.15
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-green-700 dark:text-green-400",
            ].join(" ")}
          >
            {pct(index.cancellationRate)}
          </div>

          {showCancellationDetail && index.cancelledByWorker > 0 && (
            <>
              <div className="text-muted-foreground text-xs">Cancelled by worker</div>
              <div className="font-medium tabular-nums text-red-600 dark:text-red-400">
                {index.cancelledByWorker}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Unrated notice */}
      {index.isUnrated && (
        <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          Score will appear once this worker has completed at least{" "}
          <span className="font-medium">{MIN_ASSIGNMENTS_FOR_SCORE} projects</span>.{" "}
          Currently concluded: {index.totalConcluded}.
        </div>
      )}

      {/* Signal breakdown toggle */}
      {!index.isUnrated && (
        <div>
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline focus:outline-none"
          >
            {showBreakdown ? "Hide breakdown" : "Show score breakdown"}
          </button>

          {showBreakdown && (
            <div className="mt-3 space-y-3">
              {signalEntries.map(({ key, label }) => {
                const signal = index.signals[key];
                const weightPct = Math.round(signal.effectiveWeight * 100);

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground">{weightPct}% weight</span>
                        {!signal.available && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            not enough data
                          </span>
                        )}
                      </div>
                      <span className="font-semibold tabular-nums">
                        {signal.score !== null ? `${signal.score}/100` : "—"}
                      </span>
                    </div>

                    {signal.available && signal.score !== null ? (
                      <div className="relative h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full rounded-full"
                          style={{
                            width: `${signal.score}%`,
                            backgroundColor:
                              signal.score >= 75 ? "#639922" :
                              signal.score >= 50 ? "#BA7517" :
                                                   "#E24B4A",
                          }}
                        />
                      </div>
                    ) : (
                      <div className="h-1.5 w-full rounded-full bg-black/5" />
                    )}
                  </div>
                );
              })}

              <div className="pt-1 border-t text-[10px] text-muted-foreground">
                Weights redistribute automatically when a signal has insufficient data.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}