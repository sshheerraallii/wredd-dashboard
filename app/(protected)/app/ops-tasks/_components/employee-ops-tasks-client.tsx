"use client";

// app/(protected)/app/ops-tasks/_components/employee-ops-tasks-client.tsx

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOpsTaskInstance } from "@/lib/ops-tasks/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type Instance = {
  id: string;
  title: string;
  status: string;
  task: { id: string; type: string; description: string | null };
  timerHours: number;
  dueAt: string;
  originalDueAt: string;
  createdAt: string;
  completedAt: string | null;
  completionNote: string | null;
  points: number | null;
  deadlineExtendedAt: string | null;
  deadlineExtendedBy: { id: string; fullName: string } | null;
  reopenedAt: string | null;
  reopenedBy: { id: string; fullName: string } | null;
};

type Score = {
  commitmentPct: number;
  totalPossible: number;
  totalEarned: number;
  taskCount: number;
  doneCount: number;
  lateCount: number;
  pendingCount: number;
};

type Props = {
  initialTab: string;
  pending: Instance[];
  completed: Instance[];
  score: Score;
  userName: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimer(dueAt: string, now = new Date()) {
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();
  const totalMins = Math.floor(Math.abs(diffMs) / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const isLate = diffMs < 0;
  const label =
    hrs > 0
      ? `${hrs}h ${mins}m ${isLate ? "overdue" : "remaining"}`
      : `${mins}m ${isLate ? "overdue" : "remaining"}`;
  const urgency =
    !isLate && diffMs < 2 * 60 * 60 * 1000
      ? "warn"
      : isLate
      ? "late"
      : "ok";
  return { label, isLate, urgency };
}

function scoreColor(pct: number) {
  if (pct >= 80) return "#34d399";
  if (pct >= 60) return "#fbbf24";
  return "#f87171";
}

function scoreMessage(pct: number, name: string) {
  const first = name.split(" ")[0];
  if (pct >= 90) return `Great work, ${first}! You're on top of everything.`;
  if (pct >= 80) return `Solid commitment, ${first}. Keep it up.`;
  if (pct >= 60) return `A few tasks are slipping — let's close them out.`;
  return `Some tasks need attention. You can catch up.`;
}

function ScoreRing({ pct, size = 64 }: { pct: number; size?: number }) {
  const color = scoreColor(pct);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#262d40"
          strokeWidth={5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <div
          className="font-mono font-bold leading-none"
          style={{ fontSize: size * 0.2, color }}
        >
          {pct}%
        </div>
      </div>
    </div>
  );
}

// ─── Complete Modal ───────────────────────────────────────────────────────────

function CompleteModal({
  instance,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const { isLate } = formatTimer(instance.originalDueAt);

  async function handleSubmit() {
    setError("");
    startTransition(async () => {
      try {
        await completeOpsTaskInstance({
          instanceId: instance.id,
          note: note.trim() || undefined,
        });
        onClose();
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#262d40] bg-[#181c27] p-6 shadow-2xl">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
          <span className="text-green-400">✓</span> Mark as Done
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{instance.title}</p>

        {isLate && (
          <div className="mb-4 rounded-lg border border-amber-900/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
            ⚠ This task is overdue. Your score will reflect the late completion — but getting it done still counts.
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {isLate ? "Reason for delay (optional)" : "Notes (optional)"}
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full resize-none rounded-lg border border-[#262d40] bg-[#1e2333] px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder={
                isLate
                  ? "What caused the delay?"
                  : "Any notes on completion..."
              }
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="flex-1 rounded-lg bg-green-500 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Mark Complete"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-[#262d40] px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Task Card (employee) ─────────────────────────────────────────────────────

function EmployeeTaskCard({
  instance,
  onComplete,
}: {
  instance: Instance;
  onComplete: (i: Instance) => void;
}) {
  const isDone = instance.status === "COMPLETED";
  const isRecurring = instance.task.type === "RECURRING";
  const { label, urgency } = formatTimer(instance.dueAt);

  const timerColors = {
    ok: { bg: "rgba(52,211,153,.12)", text: "#34d399", icon: "◷" },
    warn: { bg: "rgba(251,191,36,.12)", text: "#fbbf24", icon: "◷" },
    late: { bg: "rgba(248,113,113,.12)", text: "#f87171", icon: "⚠" },
  };
  const tc = timerColors[urgency as keyof typeof timerColors];

  return (
    <div
      className={`rounded-xl border border-[#262d40] bg-[#181c27] p-4 transition hover:border-[#3a4160] ${
        isDone ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Check circle */}
        <div className="mt-0.5 shrink-0">
          {isDone ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full border border-green-500 bg-green-500/10 text-[10px] text-green-400">
              ✓
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full border border-[#3a4160]" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-sm font-medium">{instance.title}</span>
            {isRecurring && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  background: "rgba(167,139,250,.12)",
                  color: "#a78bfa",
                }}
              >
                ↻ Daily
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Timer */}
            {!isDone && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-mono font-medium"
                style={{ background: tc.bg, color: tc.text }}
              >
                {tc.icon} {label}
              </span>
            )}

            {/* Points earned */}
            {isDone && instance.points !== null && (
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{
                  background: "rgba(52,211,153,.12)",
                  color: "#34d399",
                }}
              >
                +{instance.points} pts
              </span>
            )}

            {/* Completed timestamp */}
            {isDone && instance.completedAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(instance.completedAt).toLocaleDateString("en-PK", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}

            {/* Extended note */}
            {instance.deadlineExtendedAt && !isDone && (
              <span className="text-xs text-amber-400">
                Deadline extended
              </span>
            )}
          </div>

          {/* Reopened warning */}
          {instance.reopenedAt && (
            <p className="mt-1.5 text-xs text-amber-400">
              ↩ Reopened by{" "}
              {instance.reopenedBy?.fullName ?? "admin"} — please re-complete
            </p>
          )}

          {/* Completion note */}
          {isDone && instance.completionNote && (
            <p className="mt-1.5 text-xs italic text-muted-foreground">
              "{instance.completionNote}"
            </p>
          )}

          {/* Description */}
          {instance.task.description && !isDone && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {instance.task.description}
            </p>
          )}
        </div>

        {/* Done button */}
        {!isDone && (
          <button
            onClick={() => onComplete(instance)}
            className="shrink-0 rounded-lg border border-[#262d40] px-3 py-1.5 text-xs text-muted-foreground transition hover:border-green-500/40 hover:bg-green-500/10 hover:text-green-400"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

export function EmployeeOpsTasksClient({
  initialTab,
  pending,
  completed,
  score,
  userName,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [completeTarget, setCompleteTarget] = useState<Instance | null>(null);

  const shown = tab === "pending" ? pending : completed;
  const color = scoreColor(score.commitmentPct);

  return (
    <div className="min-h-screen pb-16">
      {completeTarget && (
        <CompleteModal
          instance={completeTarget}
          onClose={() => setCompleteTarget(null)}
        />
      )}

      {/* Header */}
      <div className="border-b border-[#262d40] px-6 py-5">
        <h1 className="text-lg font-semibold">My Tasks</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Stay on top of your daily work
        </p>
      </div>

      {/* Score banner */}
      <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border border-[#262d40] bg-[#181c27] p-4">
        <ScoreRing pct={score.commitmentPct} size={64} />
        <div className="flex-1">
          <div className="text-sm font-semibold">This month's commitment</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {score.doneCount} of {score.taskCount} tasks done
            {score.lateCount > 0 ? ` · ${score.lateCount} completed late` : ""}
            {score.pendingCount > 0 ? ` · ${score.pendingCount} open` : ""}
          </div>
          <div className="mt-1.5 text-xs font-medium" style={{ color }}>
            {scoreMessage(score.commitmentPct, userName)}
          </div>
        </div>
        {/* Points summary */}
        {score.totalPossible > 0 && (
          <div className="hidden shrink-0 text-right sm:block">
            <div className="font-mono text-lg font-bold" style={{ color }}>
              {score.totalEarned}
              <span className="text-sm text-muted-foreground font-normal">
                /{score.totalPossible}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">pts</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex w-fit gap-1 rounded-xl border border-[#262d40] bg-[#181c27] p-1">
          {[
            { key: "pending", label: `Pending (${pending.length})` },
            { key: "completed", label: `Completed (${completed.length})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                const sp = new URLSearchParams({ tab: key });
                router.push(`/app/ops-tasks?${sp.toString()}`);
              }}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                tab === key
                  ? "bg-[#1e2333] text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-3 px-6 pt-4">
        {shown.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <div className="mb-3 text-3xl">
              {tab === "pending" ? "✓" : "📋"}
            </div>
            <p className="text-sm">
              {tab === "pending"
                ? "No pending tasks. You're all caught up!"
                : "No completed tasks yet."}
            </p>
          </div>
        ) : (
          shown.map((inst) => (
            <EmployeeTaskCard
              key={inst.id}
              instance={inst}
              onComplete={setCompleteTarget}
            />
          ))
        )}
      </div>
    </div>
  );
}