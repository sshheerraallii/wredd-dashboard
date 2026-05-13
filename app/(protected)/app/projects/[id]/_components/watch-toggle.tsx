"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { watchProject, unwatchProject } from "../actions/watch";

type Role = "SUPER_ADMIN" | "MANAGER" | "BUSINESS_DEVELOPER" | "REMOTE_WORKER" | "ONSITE_EMPLOYEE" | "BD";

function isAdminish(role: Role | undefined) {
  return role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER" || role === "BD";
}

export function WatchToggle(props: { projectId: string; role?: Role; isWatched: boolean }) {
  const [pending, start] = useTransition();

  if (!isAdminish(props.role)) return null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 text-sm font-medium">Notifications</div>
      <div className="mb-3 text-xs text-muted-foreground">
        Watch to receive in-app notifications for this project’s activity.
      </div>

      {props.isWatched ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => start(async () => unwatchProject({ projectId: props.projectId }))}
        >
          Watching • Click to unwatch
        </Button>
      ) : (
        <Button
          type="button"
          disabled={pending}
          onClick={() => start(async () => watchProject({ projectId: props.projectId }))}
        >
          Watch (Receive notifications)
        </Button>
      )}
    </div>
  );
}
