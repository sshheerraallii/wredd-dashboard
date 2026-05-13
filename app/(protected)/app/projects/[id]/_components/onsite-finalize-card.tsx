"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { finalizeOnsitePerformance } from "../actions/onsite-performance";

type Worker = {
  userId: string;
  fullName: string;
};

export function OnsiteFinalizeCard({
  projectId,
  onsiteWorkers,
  suggestedLabel,
}: {
  projectId: string;
  onsiteWorkers: Worker[];
  suggestedLabel: string;
}) {
  const [stars, setStars] = React.useState([3, 3, 3, 3, 3]);
  const [points, setPoints] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(onsiteWorkers.map((w) => [w.userId, 0]))
  );
  const [submitting, setSubmitting] = React.useState(false);

  const labels = ["Quality", "Speed", "Communication", "Professionalism", "Accuracy"];

  // If onsiteWorkers changes (edge: assignments changed before finalize), keep state sane.
  React.useEffect(() => {
    setPoints((prev) => {
      const next: Record<string, number> = {};
      for (const w of onsiteWorkers) next[w.userId] = prev[w.userId] ?? 0;
      return next;
    });
  }, [onsiteWorkers]);

  async function submit() {
    setSubmitting(true);

    const form = new FormData();
    form.set("m1", String(stars[0]));
    form.set("m2", String(stars[1]));
    form.set("m3", String(stars[2]));
    form.set("m4", String(stars[3]));
    form.set("m5", String(stars[4]));

    form.set(
      "credits",
      JSON.stringify(
        onsiteWorkers.map((w) => ({
          userId: w.userId,
          points: points[w.userId] ?? 0,
        }))
      )
    );

    await finalizeOnsitePerformance(projectId, form);
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="text-sm font-medium">Finalize Onsite Performance</div>
      <div className="text-xs text-muted-foreground">
        Submit the onsite rating + assign performance points per onsite worker.
      </div>

      {/* Stars */}
      <div className="grid gap-2">
        {labels.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            <div className="w-32 text-sm">{label}</div>

            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() =>
                    setStars((s) => {
                      const n = [...s];
                      n[i] = v;
                      return n;
                    })
                  }
                  aria-label={`${label} ${v} stars`}
                  className={[
                    "h-9 w-9 rounded-md border text-lg leading-none transition",
                    "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40",
                    stars[i] >= v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground",
                  ].join(" ")}
                >
                  ★
                </button>
              ))}
            </div>

            <div className="text-xs text-muted-foreground w-10 text-right">{stars[i]}/5</div>
          </div>
        ))}
      </div>

      {/* Points */}
      <div className="rounded-lg border bg-background/40 p-3">
        <div className="text-sm font-medium">Points for this project</div>
        <div className="text-xs text-muted-foreground">
          Enter the performance points credited to each onsite worker (can be split).{" "}
          <span className="font-medium">Suggested:</span> {suggestedLabel}
        </div>

        <div className="mt-3 grid gap-2">
          {onsiteWorkers.map((w) => (
            <div key={w.userId} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{w.fullName}</div>
                <div className="text-xs text-muted-foreground">Performance points</div>
              </div>

              <input
                type="number"
                className="w-28 rounded-md border bg-background px-2 py-1 text-sm"
                value={points[w.userId] ?? 0}
                min={0}
                onChange={(e) =>
                  setPoints((p) => ({
                    ...p,
                    [w.userId]: Number(e.target.value || 0),
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <Button onClick={submit} disabled={submitting}>
        {submitting ? "Saving..." : "Finalize Onsite"}
      </Button>
    </div>
  );
}
