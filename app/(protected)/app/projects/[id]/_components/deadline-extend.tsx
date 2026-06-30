"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { extendDeadline } from "../actions/deadline";

export function DeadlineExtend({
  projectId,
  canExtend,
}: {
  projectId: string;
  canExtend: boolean;
}) {
  const router = useRouter();
  const [hours, setHours] = React.useState<string>("");
  const [pending, start] = useTransition();

  if (!canExtend) return null;

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="text-sm font-semibold">Extend deadline</div>

      <div className="flex gap-2">
        <Input
          inputMode="numeric"
          placeholder="Add hours (e.g. 12)"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          disabled={pending}
        />
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            const n = Number(hours);
            if (!Number.isFinite(n) || n <= 0) return;

            start(async () => {
              await extendDeadline({ projectId, addHours: n });

              // force this page to fetch fresh server data immediately
              router.refresh();

              setHours("");
            });
          }}
        >
          {pending ? "Extending…" : "Extend"}
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        Adds hours to the total deadline and logs a system message.
      </div>
    </div>
  );
}
