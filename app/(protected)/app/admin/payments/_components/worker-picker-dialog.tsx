"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Worker = { id: string; fullName: string | null; username: string | null };

function joinQuery(baseHref: string, params: Record<string, string | undefined>) {
  const hasQuery = baseHref.includes("?");
  const sep = hasQuery ? "&" : "?";

  const qs = Object.entries(params)
    .filter(([, v]) => typeof v === "string" && (v as string).length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");

  return qs ? `${baseHref}${sep}${qs}` : baseHref;
}

export function WorkerPickerDialog(props: {
  workers: Worker[];
  selectedWorkerId?: string;
  baseHref: string; // e.g. "/app/admin/payments/worker" OR "/app/admin/payments?tab=worker"
  defaultTab?: "due" | "clearing" | "active" | "history"; // optional for worker page
}) {
  const { workers, selectedWorkerId, baseHref, defaultTab } = props;

  const selected = selectedWorkerId
    ? workers.find((w) => w.id === selectedWorkerId)
    : undefined;

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return workers;
    return workers.filter((w) => {
      const a = (w.fullName ?? "").toLowerCase();
      const b = (w.username ?? "").toLowerCase();
      return a.includes(needle) || b.includes(needle);
    });
  }, [workers, q]);

  const label = selected
    ? `${selected.fullName ?? "Unnamed"} (${selected.username ?? "—"})`
    : "Select worker";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" type="button">
          {label}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select worker</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or username…"
            className="h-10"
          />

          <div className="max-h-[50vh] overflow-auto rounded-md border">
            {filtered.length ? (
              <div className="divide-y">
                {filtered.map((w) => {
                  const href = joinQuery(baseHref, {
                    workerId: w.id,
                    tab: defaultTab, // only included if provided
                  });

                  const on = selectedWorkerId === w.id;

                  return (
                    <Link
                      key={w.id}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={[
                        "block px-3 py-2 text-sm hover:bg-accent/50",
                        on ? "bg-accent text-accent-foreground" : "",
                      ].join(" ")}
                    >
                      <div className="font-medium">
                        {w.fullName ?? "Unnamed"}{" "}
                        <span className="text-muted-foreground">
                          ({w.username ?? "—"})
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No workers found.
              </div>
            )}
          </div>

          {selectedWorkerId ? (
            <div className="text-xs text-muted-foreground">
              <Link
                href={baseHref}
                onClick={() => setOpen(false)}
                className="hover:underline"
              >
                Clear selection
              </Link>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
