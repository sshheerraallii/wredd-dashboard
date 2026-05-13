"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  // Workers: DELIVERED only (server enforces active assignment)
  if (isWorker(role)) {
    return status === "IN_PROGRESS" || status === "REVISION" ? ["DELIVERED"] : [];
  }

  if (!isAdminish(role)) return [];

  // Adminish rules per your request:
  // - DELIVERED is NOT allowed for BD/Manager
  // - COMPLETED only from DELIVERED
  // - REVISION requires message (handled by UI + server)
  // - CANCELLED allowed anytime (UI confirm + server allow)
  switch (status) {
    case "UNASSIGNED":
      return ["IN_PROGRESS", "CANCELLED"];
    case "IN_PROGRESS":
      return ["REVISION", "CANCELLED"]; // no DELIVERED, no COMPLETED
    case "DELIVERED":
      return ["COMPLETED", "REVISION", "IN_PROGRESS", "CANCELLED"];
    case "REVISION":
      return ["IN_PROGRESS", "CANCELLED"]; // no DELIVERED, no COMPLETED
    case "COMPLETED":
      return ["REVISION", "IN_PROGRESS", "CANCELLED"];
    case "CANCELLED":
      return ["IN_PROGRESS", "CANCELLED"]; // allow re-open; cancel again is harmless
    default:
      return [];
  }
}

export function StatusControls(props: { projectId: string; role?: Role; status: ProjectStatus }) {
  const actions = nextActions(props.role, props.status);
  const [isPending, startTransition] = useTransition();

  const [revisionOpen, setRevisionOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const [note, setNote] = React.useState("");
  const [target, setTarget] = React.useState<ProjectStatus | null>(null);

  if (!actions.length) return null;

  function run(nextStatus: ProjectStatus, noteArg?: string) {
    startTransition(async () => {
      await setProjectStatus({
        projectId: props.projectId,
        nextStatus,
        note: noteArg?.trim() || undefined,
      });
    });
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

          // CANCELLED -> confirm dialog with warning text (and optional reason)
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

          // Normal one-click actions
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

      {/* REVISION dialog (message required) */}
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

      {/* CANCELLED confirmation */}
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
