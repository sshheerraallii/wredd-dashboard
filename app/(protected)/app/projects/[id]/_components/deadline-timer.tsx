"use client";

import * as React from "react";

function secondsBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmt2(n: number) {
  return String(n).padStart(2, "0");
}

function humanState(timerRunning: boolean) {
  return timerRunning ? "Running" : "Paused";
}

export function DeadlineTimer(props: {
  deadlineHours: number;
  timerRunning: boolean;
  timerLastResumedAt: string | null; // ISO string
  timerAccumulatedSeconds: number;
}) {
  const { deadlineHours, timerRunning, timerLastResumedAt, timerAccumulatedSeconds } = props;

  // Hydration-safe: render a stable placeholder until mounted.
  const [mounted, setMounted] = React.useState(false);
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const totalSeconds = Math.max(0, Math.floor(deadlineHours * 3600));

  // Server + first client paint: stable skeleton to avoid mismatch
  if (!mounted || !now) {
    return (
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Deadline</div>
            <div className="text-base font-semibold">Project Timer</div>
            <div className="text-xs text-muted-foreground">
              {deadlineHours}h • {humanState(timerRunning)}
            </div>
          </div>

          <div className="rounded-2xl border bg-background/40 px-5 py-4">
            <div className="text-[42px] leading-none font-semibold tabular-nums sm:text-[56px]">
              --:--:--
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              hh : mm : ss
            </div>
          </div>
        </div>
      </div>
    );
  }

  const last = timerLastResumedAt ? new Date(timerLastResumedAt) : null;
  const liveAdd = timerRunning && last ? secondsBetween(now, last) : 0;
  const used = (timerAccumulatedSeconds || 0) + liveAdd;

  const rawRemaining = totalSeconds - used;
  const overdue = rawRemaining < 0;

  const remaining = clamp(Math.abs(rawRemaining), 0, 999999999);

  const hh = Math.floor(remaining / 3600);
  const mm = Math.floor((remaining % 3600) / 60);
  const ss = remaining % 60;

  // Simple urgency tiers
  const remainingPct = totalSeconds > 0 ? rawRemaining / totalSeconds : 0;
  const isCritical = rawRemaining <= 15 * 60; // last 15 minutes
  const isWarning = !isCritical && remainingPct <= 0.25; // last 25%

  const tone = overdue
    ? "border-destructive/40 bg-destructive/10"
    : isCritical
      ? "border-destructive/30 bg-destructive/5"
      : isWarning
        ? "border-primary/30 bg-primary/5"
        : "border-border bg-background/40";

  const pillTone = overdue
    ? "bg-destructive/15 text-destructive"
    : timerRunning
      ? "bg-emerald-500/10 text-emerald-500"
      : "bg-muted text-muted-foreground";

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Deadline</div>

          <div className="flex items-center gap-2">
            <div className="text-base font-semibold">Project Timer</div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pillTone}`}>
              {humanState(timerRunning)}
            </span>
          </div>

          <div className="text-xs text-muted-foreground">
            Target: <span className="font-medium">{deadlineHours}h</span>
            {overdue ? (
              <span className="ml-2 text-destructive">Overdue</span>
            ) : isCritical ? (
              <span className="ml-2 text-destructive">Critical</span>
            ) : isWarning ? (
              <span className="ml-2">Near deadline</span>
            ) : null}
          </div>
        </div>

        <div className={`rounded-2xl border px-5 py-4 ${tone}`}>
          <div className="flex items-baseline justify-center gap-2">
            <div className="text-[44px] font-semibold leading-none tabular-nums sm:text-[64px]">
              {overdue ? "-" : ""}
              {fmt2(hh)}:{fmt2(mm)}:{fmt2(ss)}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>hh : mm : ss</span>
            <span>{overdue ? "past due" : "remaining"}</span>
          </div>

          {/* Subtle progress bar */}
          {!overdue && totalSeconds > 0 ? (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground/30"
                style={{
                  width: `${clamp((rawRemaining / totalSeconds) * 100, 0, 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
