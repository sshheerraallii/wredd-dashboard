"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { setProjectStatus } from "../actions/status";

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

type ProjectStatus =
  | "UNASSIGNED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "REVISION"
  | "COMPLETED"
  | "CANCELLED";

type ActiveWorker = {
  userId: string;
  fullName: string;
};

function isWorker(role: Role | undefined) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

function isAdminish(role: Role | undefined) {
  return role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";
}

function label(s: ProjectStatus) {
  return s.replace(/_/g, " ");
}

function nextActions(role: Role | undefined, status: ProjectStatus): ProjectStatus[] {
  if (isWorker(role)) {
    return status === "IN_PROGRESS" || status === "REVISION" ? ["DELIVERED"] : [];
  }

  if (!isAdminish(role)) return [];

  switch (status) {
    case "UNASSIGNED":
      return ["IN_PROGRESS", "CANCELLED"];
    case "IN_PROGRESS":
      return ["REVISION", "CANCELLED"];
    case "DELIVERED":
      return ["COMPLETED", "REVISION", "IN_PROGRESS", "CANCELLED"];
    case "REVISION":
      return ["IN_PROGRESS", "CANCELLED"];
    case "COMPLETED":
      return ["REVISION", "IN_PROGRESS", "CANCELLED"];
    case "CANCELLED":
      return ["IN_PROGRESS", "CANCELLED"];
    default:
      return [];
  }
}

export function StatusControls(props: {
  projectId: string;
  role?: Role;
  status: ProjectStatus;
  /** Active workers on this project — used for the completion dialog */
  activeWorkers?: ActiveWorker[];
  /** Project deadline in hours — used to show auto-calc hint in dialog */
  deadlineHours?: number | null;
}) {
  const actions = nextActions(props.role, props.status);
  const [isPending, startTransition] = useTransition();

  const [revisionOpen, setRevisionOpen]     = React.useState(false);
  const [cancelOpen, setCancelOpen]         = React.useState(false);
  const [completionOpen, setCompletionOpen] = React.useState(false);

  const [note, setNote]   = React.useState("");
  const [target, setTarget] = React.useState<ProjectStatus | null>(null);

  // Per-worker hours-late inputs: key = userId, value = string (empty = on time / auto)
  const [latenessMap, setLatenessMap] = React.useState<Record<string, string>>({});

  if (!actions.length) return null;

  const workers = props.activeWorkers ?? [];
  const hasDeadline = (props.deadlineHours ?? 0) > 0;

  function run(
    nextStatus: ProjectStatus,
    noteArg?: string,
    workerLateness?: { userId: string; hoursLate: number }[]
  ) {
    startTransition(async () => {
      await setProjectStatus({
        projectId: props.projectId,
        nextStatus,
        note: noteArg?.trim() || undefined,
        workerLateness,
      });
    });
  }

  function handleCompleteConfirm() {
    // Build workerLateness array from inputs
    // Empty / non-numeric = 0 (on time)
    const workerLateness = workers.map((w) => {
      const raw = latenessMap[w.userId] ?? "";
      const parsed = parseFloat(raw);
      return {
        userId: w.userId,
        hoursLate: isNaN(parsed) || parsed < 0 ? 0 : parsed,
      };
    });

    setCompletionOpen(false);
    run("COMPLETED", undefined, workerLateness.length > 0 ? workerLateness : undefined);
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 text-sm font-medium">Status</div>
      <div className="mb-3 text-xs text-muted-foreground">Current: {label(props.status)}</div>

      <div className="flex flex-wrap gap-2">
        {actions.map((next) => {
          // REVISION -> dialog (message required)
          if (next === "REVISION") {
            return (
              <Button
                key={next}
                type="button"
                className="h-9"
                disabled={isPending}
                onClick={() => {
                  setTarget("REVISION");
                  setNote("");
                  setRevisionOpen(true);
                }}
              >
                Set {label(next)}
              </Button>
            );
          }

          // CANCELLED -> confirm dialog
          if (next === "CANCELLED") {
            return (
              <Button
                key={next}
                type="button"
                variant="destructive"
                className="h-9"
                disabled={isPending}
                onClick={() => {
                  setTarget("CANCELLED");
                  setNote("");
                  setCancelOpen(true);
                }}
              >
                Set {label(next)}
              </Button>
            );
          }

          // COMPLETED -> completion dialog (per-worker lateness)
          if (next === "COMPLETED") {
            return (
              <Button
                key={next}
                type="button"
                className="h-9"
                disabled={isPending}
                onClick={() => {
                  setLatenessMap({});
                  setCompletionOpen(true);
                }}
              >
                Set {label(next)}
              </Button>
            );
          }

          // All other actions: one-click
          return (
            <Button
              key={next}
              type="button"
              className="h-9"
              disabled={isPending}
              onClick={() => run(next)}
            >
              Set {label(next)}
            </Button>
          );
        })}
      </div>

      {/* ── COMPLETION DIALOG ─────────────────────────────────────────── */}
      <Dialog
        open={completionOpen}
        onOpenChange={(open) => {
          if (!isPending) setCompletionOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Complete project</DialogTitle>
            <DialogDescription>
              {workers.length > 0
                ? "Enter how many hours late each worker delivered their part. Leave blank if they were on time."
                : "Confirm you want to mark this project as completed."}
            </DialogDescription>
          </DialogHeader>

          {workers.length > 0 && (
            <div className="space-y-3 py-1">
              {!hasDeadline && (
                <p className="text-xs text-muted-foreground rounded-md bg-muted px-3 py-2">
                  No deadline set — lateness values will be stored but won&apos;t affect
                  on-time scoring (no deadline to compare against).
                </p>
              )}

              {workers.map((w) => (
                <div key={w.userId} className="flex items-center gap-3">
                  <div className="flex-1 text-sm font-medium truncate">{w.fullName}</div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="0"
                      className="h-8 w-24 text-right"
                      value={latenessMap[w.userId] ?? ""}
                      onChange={(e) =>
                        setLatenessMap((prev) => ({
                          ...prev,
                          [w.userId]: e.target.value,
                        }))
                      }
                      disabled={isPending}
                    />
                    <span className="text-xs text-muted-foreground w-8">hrs late</span>
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted-foreground pt-1">
                0 or blank = delivered on time. Fractions allowed (e.g. 1.5 = 1.5 hrs late).
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => setCompletionOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={handleCompleteConfirm}
            >
              {isPending ? "Saving…" : "Confirm completion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── REVISION DIALOG ───────────────────────────────────────────── */}
      <Dialog
        open={revisionOpen}
        onOpenChange={(open) => {
          if (!isPending) setRevisionOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request revision</DialogTitle>
            <DialogDescription>
              A revision status requires a message. This will be saved in chat/activity.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm font-medium">Revision message</div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain what needs to be changed..."
              rows={5}
              disabled={isPending}
            />
            <div className="text-xs text-muted-foreground">
              Minimum 3 characters. Be specific.
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => setRevisionOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending || note.trim().length < 3 || target !== "REVISION"}
              onClick={() => {
                setRevisionOpen(false);
                run("REVISION", note);
              }}
            >
              Confirm revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CANCEL DIALOG ─────────────────────────────────────────────── */}
      <AlertDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!isPending) setCancelOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the project as <b>CANCELLED</b>. If workers are assigned, this can affect
              their completion rate/metrics. You can reopen later, but the cancellation will be
              logged.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-3 space-y-2">
            <div className="text-sm font-medium">Reason (optional)</div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Client withdrew / Scope changed / Duplicate project..."
              rows={3}
              disabled={isPending}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>No, keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || target !== "CANCELLED"}
              onClick={() => run("CANCELLED", note)}
            >
              Yes, cancel project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}