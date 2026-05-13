"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  assignWorkerToProject,
  unassignWorkerFromProject,
  unassignAndCancelForWorker,
} from "../actions/assignments";

type Worker = {
  id: string;
  fullName: string;
  role: "REMOTE_WORKER" | "ONSITE_EMPLOYEE";
  workerType?: string | null;
};

type Assigned = { userId: string; fullName: string };

function isRemote(w?: Worker | null) {
  return w?.role === "REMOTE_WORKER";
}

function isOnsite(w?: Worker | null) {
  return w?.role === "ONSITE_EMPLOYEE";
}

export function AssignmentsCard({
  projectId,
  canManage,
  workers,
  assigned,
}: {
  projectId: string;
  canManage: boolean;
  workers: Worker[];
  assigned: Assigned[];
}) {
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [amount, setAmount] = React.useState<string>(""); // remote payout
  const [allowedHours, setAllowedHours] = React.useState<string>(""); // onsite allowed hours
  const [busy, setBusy] = React.useState(false);

  if (!canManage) return null;

  const selected = React.useMemo(
    () => workers.find((w) => w.id === selectedId) ?? null,
    [workers, selectedId]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) => w.fullName.toLowerCase().includes(q));
  }, [workers, query]);

  function resetModal() {
    setQuery("");
    setSelectedId("");
    setAmount("");
    setAllowedHours("");
  }

  async function handleAssign() {
    if (!selectedId || busy) return;

    setBusy(true);
    try {
      await assignWorkerToProject({
        projectId,
        userId: selectedId,
        amount: amount.trim() ? amount.trim() : undefined,
        allowedHours: allowedHours.trim() ? Number(allowedHours.trim()) : undefined,
      });

      router.refresh();
      setOpen(false);
      resetModal();
    } finally {
      setBusy(false);
    }
  }

  async function handleUnassign(targetUserId: string) {
    if (!targetUserId || busy) return;

    setBusy(true);
    try {
      await unassignWorkerFromProject({ projectId, userId: targetUserId });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleUnassignAndCancel(targetUserId: string) {
    if (!targetUserId || busy) return;

    setBusy(true);
    try {
      await unassignAndCancelForWorker({ projectId, userId: targetUserId });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const canAssign =
    !!selectedId &&
    !busy &&
    (!isRemote(selected) || !!amount.trim()) &&
    (!isOnsite(selected) || !!allowedHours.trim());

  return (
    <div className="rounded-xl border border-white/10 bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Assignments</div>

        <Dialog open={open} onOpenChange={(v) => (busy ? null : setOpen(v))}>
          <DialogTrigger asChild>
            <Button type="button" disabled={busy}>
              Assign worker
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Assign worker</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search worker by name…"
                disabled={busy}
              />

              <div className="max-h-64 overflow-auto rounded-lg border">
                {filtered.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No workers found.</div>
                ) : (
                  <div className="divide-y">
                    {filtered.map((w) => {
                      const active = w.id === selectedId;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          disabled={busy}
                          onClick={() => setSelectedId(w.id)}
                          className={[
                            "w-full text-left px-3 py-2 text-sm transition-colors",
                            active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                          ].join(" ")}
                        >
                          <div className="font-medium">{w.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {w.role}
                            {w.workerType ? ` • ${w.workerType}` : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Remote payment */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-medium">Payment (remote only)</div>
                <div className="text-xs text-muted-foreground">
                  If selected worker is REMOTE, this is their worker payout line for this project.
                </div>

                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={isRemote(selected) ? "e.g., 120.00 (required for remote)" : "—"}
                  inputMode="decimal"
                  disabled={busy || !isRemote(selected)}
                />
              </div>

              {/* Onsite allowed hours */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-medium">Allowed hours (onsite only)</div>
                <div className="text-xs text-muted-foreground">
                  Required for onsite projects (used for costing + commission overhead).
                </div>

                <Input
                  value={allowedHours}
                  onChange={(e) => setAllowedHours(e.target.value)}
                  placeholder={isOnsite(selected) ? "e.g., 12 (required for onsite)" : "—"}
                  inputMode="numeric"
                  disabled={busy || !isOnsite(selected)}
                />
              </div>

              {selected ? (
                <div className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium">{selected.fullName}</span> • {selected.role}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Select a worker above.</div>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    resetModal();
                  }}
                >
                  Cancel
                </Button>

                <Button type="button" disabled={!canAssign} onClick={handleAssign}>
                  {busy ? "Working..." : "Assign"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {assigned.length === 0 ? (
          <div className="text-sm text-muted-foreground">No workers assigned.</div>
        ) : (
          assigned.map((a) => (
            <div
              key={a.userId}
              className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2"
            >
              <div className="text-sm">{a.fullName}</div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => handleUnassign(a.userId)}
                >
                  {busy ? "Working..." : "Unassign"}
                </Button>

                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => handleUnassignAndCancel(a.userId)}
                  title="Cancels only for this worker (does not cancel the project)"
                >
                  {busy ? "Working..." : "Unassign & Cancel"}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}