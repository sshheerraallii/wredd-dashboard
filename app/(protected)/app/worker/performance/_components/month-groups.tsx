"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export type MonthGroupRow = {
  projectId: string;
  title: string;
  status: string;
  rating: number | null;
  points: number;
};

export type MonthGroup = {
  monthKey: string;
  totalPoints: number;
  accuracy: number | null;
  avgRating: number | null;
  rows: MonthGroupRow[];
};

export function MonthGroups(props: { groups: MonthGroup[] }) {
  const { groups } = props;

  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  function toggle(mk: string) {
    setOpen((prev) => ({ ...prev, [mk]: !prev[mk] }));
  }

  if (!groups.length) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No months found for this range.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const isOpen = !!open[g.monthKey];

        return (
          <div key={g.monthKey} className="rounded-xl border bg-card">
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">{g.monthKey}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Points: <span className="font-medium">{g.totalPoints}</span>{" "}
                  • Accuracy:{" "}
                  <span className="font-medium">
                    {g.accuracy != null ? `${g.accuracy}%` : "—"}
                  </span>{" "}
                  • Avg rating:{" "}
                  <span className="font-medium">
                    {g.avgRating != null ? g.avgRating.toFixed(1) : "—"}
                  </span>
                </div>
              </div>

              <Button
                variant="secondary"
                onClick={() => toggle(g.monthKey)}
                className="w-full sm:w-auto"
              >
                {isOpen ? "Hide projects" : "Show projects"}
              </Button>
            </div>

            {isOpen ? (
              <div className="border-t">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 px-4 text-left">Project</th>
                        <th className="py-2 px-4 text-left">Status</th>
                        <th className="py-2 px-4 text-right">Rating</th>
                        <th className="py-2 px-4 text-right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={`${g.monthKey}:${r.projectId}`} className="border-b last:border-b-0">
                          <td className="py-2 px-4">
                            <div className="font-medium">{r.title}</div>
                            <div className="text-xs text-muted-foreground">{r.projectId}</div>
                          </td>
                          <td className="py-2 px-4">{r.status}</td>
                          <td className="py-2 px-4 text-right">
                            {r.rating != null ? r.rating.toFixed(1) : "—"}
                          </td>
                          <td className="py-2 px-4 text-right">{r.points}</td>
                        </tr>
                      ))}

                      {!g.rows.length ? (
                        <tr>
                          <td colSpan={4} className="py-6 px-4 text-center text-muted-foreground">
                            No projects in this month.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
