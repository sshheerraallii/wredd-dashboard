"use client";

// app/(protected)/app/admin/ops-tasks/_components/admin-ops-tasks-client.tsx

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createOpsTask,
  completeOpsTaskInstance,
  reopenOpsTaskInstance,
  extendOpsTaskDeadline,
  toggleOpsTaskActive,
} from "@/lib/ops-tasks/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type OpsUser = {
  id: string;
  fullName: string;
  role: string;
};

type Instance = {
  id: string;
  title: string;
  status: string;
  assigneeId: string;
  assignee: { id: string; fullName: string; role: string };
  task: { id: string; type: string; description: string | null; runOnDays: number[] };
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

type PerfRow = {
  user: { id: string; fullName: string; role: string };
  totalPossible: number;
  totalEarned: number;
  commitmentPct: number;
  taskCount: number;
  doneCount: number;
  lateCount: number;
  pendingCount: number;
};

type Props = {
  isSuperAdmin: boolean;
  actorId: string;
  opsUsers: OpsUser[];
  instances: Instance[];
  pendingCount: number;
  completedCount: number;
  performance: PerfRow[];
  perfSummary: {
    totalAssigned: number;
    totalCompleted: number;
    totalOnTime: number;
    totalPending: number;
  };
  initialTab: string;
  initialStatus: string;
  initialAssigneeFilter: string;
  initialPerfRange: string;
  initialFrom: string;
  initialTo: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  return { label, isLate, diffMs };
}

function scoreColor(pct: number) {
  if (pct >= 80) return "#34d399";
  if (pct >= 60) return "#fbbf24";
  return "#f87171";
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const USER_COLORS: Record<string, string> = {};
const PALETTE = ["#4f8ef7", "#34d399", "#a78bfa", "#fbbf24", "#f87171", "#38bdf8"];
let colorIdx = 0;
function colorFor(userId: string) {
  if (!USER_COLORS[userId]) {
    USER_COLORS[userId] = PALETTE[colorIdx % PALETTE.length];
    colorIdx++;
  }
  return USER_COLORS[userId];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TimerPill({ dueAt }: { dueAt: string }) {
  const { label, isLate } = formatTimer(dueAt);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-mono font-medium"
      style={{
        background: isLate ? "rgba(248,113,113,.12)" : "rgba(52,211,153,.12)",
        color: isLate ? "#f87171" : "#34d399",
      }}
    >
      {isLate ? "⚠" : "◷"} {label}
    </span>
  );
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "purple" | "green" | "amber" | "red";
}) {
  const map = {
    purple: { bg: "rgba(167,139,250,.12)", text: "#a78bfa" },
    green: { bg: "rgba(52,211,153,.12)", text: "#34d399" },
    amber: { bg: "rgba(251,191,36,.12)", text: "#fbbf24" },
    red: { bg: "rgba(248,113,113,.12)", text: "#f87171" },
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: map[color].bg, color: map[color].text }}
    >
      {children}
    </span>
  );
}

function ScoreRing({
  pct,
  size = 56,
}: {
  pct: number;
  size?: number;
}) {
  const color = scoreColor(pct);
  const r = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={5} />
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
          style={{ fontSize: size * 0.21, color }}
        >
          {pct}%
        </div>
      </div>
    </div>
  );
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

function CreateTaskModal({
  opsUsers,
  onClose,
}: {
  opsUsers: OpsUser[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"ONE_OFF" | "RECURRING">("ONE_OFF");
  const [runOnDays, setRunOnDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState("");

  function toggleDay(d: number) {
    setRunOnDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") ?? "").trim();
    const description = String(fd.get("description") ?? "").trim();
    const assigneeId = String(fd.get("assigneeId") ?? "");
    const timerHours = Number(fd.get("timerHours"));

    if (!title) return setError("Title is required.");
    if (!assigneeId) return setError("Please select an assignee.");
    if (!timerHours || timerHours < 1) return setError("Timer must be at least 1 hour.");
    if (type === "RECURRING" && runOnDays.length === 0)
      return setError("Select at least one day for recurring tasks.");

    startTransition(async () => {
      try {
        await createOpsTask({
          title,
          description: description || undefined,
          assigneeId,
          timerHours,
          type,
          runOnDays: type === "RECURRING" ? runOnDays : [],
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
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
        <h2 className="mb-5 text-base font-semibold">Assign New Task</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Task Title
            </label>
            <input
              name="title"
              className="w-full rounded-lg border bg-muted px-3 py-2 text-sm outline-none focus:border-ring"
              placeholder="e.g. Post Eid poster on all social media"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Description (optional)
            </label>
            <textarea
              name="description"
              rows={2}
              className="w-full rounded-lg border bg-muted px-3 py-2 text-sm outline-none focus:border-ring resize-none"
              placeholder="Any details or context..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Assign To
              </label>
              <select
                name="assigneeId"
                className="w-full rounded-lg border bg-muted px-3 py-2 text-sm outline-none focus:border-ring"
              >
                <option value="">Select person</option>
                {opsUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Deadline (hours)
              </label>
              <input
                name="timerHours"
                type="number"
                min={1}
                className="w-full rounded-lg border bg-muted px-3 py-2 text-sm outline-none focus:border-ring"
                placeholder="e.g. 24"
              />
            </div>
          </div>

          {/* Type toggle */}
          <div className="flex gap-2">
            {(["ONE_OFF", "RECURRING"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 rounded-lg border py-2 text-xs font-medium transition ${
                  type === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "ONE_OFF" ? "One-off" : "↻ Recurring daily"}
              </button>
            ))}
          </div>

          {/* Day picker for recurring */}
          {type === "RECURRING" && (
            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">
                Run on days
              </label>
              <div className="flex gap-1.5">
                {DAYS.map((day, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                      runOnDays.includes(idx)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground border hover:text-foreground"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? "Assigning..." : "Assign Task"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Extend Deadline Modal ────────────────────────────────────────────────────

function ExtendModal({
  instance,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const addHours = Number(fd.get("addHours"));
    if (!addHours || addHours < 1) return setError("Enter at least 1 hour.");

    startTransition(async () => {
      try {
        await extendOpsTaskDeadline({ instanceId: instance.id, addHours });
        onClose();
        router.refresh();
      } catch {
        setError("Something went wrong.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-2xl">
        <h2 className="mb-1 text-base font-semibold">Extend Deadline</h2>
        <p className="mb-5 text-xs text-muted-foreground">{instance.title}</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Add hours to deadline
            </label>
            <input
              name="addHours"
              type="number"
              min={1}
              className="w-full rounded-lg border bg-muted px-3 py-2 text-sm outline-none focus:border-ring"
              placeholder="e.g. 12"
            />
          </div>
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Extension is logged with your name and timestamp. The original deadline is preserved for scoring.
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? "Extending..." : "Extend"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  instance,
  isSuperAdmin,
  onExtend,
  onReopen,
}: {
  instance: Instance;
  isSuperAdmin: boolean;
  onExtend: (i: Instance) => void;
  onReopen: (id: string) => void;
}) {
  const isRecurring = instance.task.type === "RECURRING";
  const isDone = instance.status === "COMPLETED";
  const color = colorFor(instance.assignee.id);

  return (
    <div
      className={`rounded-xl border bg-card p-4 transition hover:border-muted-foreground/40 ${isDone ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-sm font-medium">{instance.title}</span>
            {isRecurring && (
              <Badge color="purple">↻ Daily</Badge>
            )}
            {isDone && instance.points !== null && (
              <Badge color="green">+{instance.points} pts</Badge>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Assignee chip */}
            <div className="flex items-center gap-1.5">
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{ background: color + "25", color }}
              >
                {initialsOf(instance.assignee.fullName)}
              </div>
              <span className="text-xs text-muted-foreground">
                {instance.assignee.fullName}
              </span>
            </div>

            {/* Timer */}
            {!isDone && <TimerPill dueAt={instance.dueAt} />}

            {/* Completed info */}
            {isDone && instance.completedAt && (
              <span className="text-xs text-muted-foreground">
                Completed{" "}
                {new Date(instance.completedAt).toLocaleDateString("en-PK", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}

            {/* Extension badge */}
            {instance.deadlineExtendedAt && (
              <Badge color="amber">
                Extended by {instance.deadlineExtendedBy?.fullName ?? "admin"}
              </Badge>
            )}
          </div>

          {/* Completion note */}
          {isDone && instance.completionNote && (
            <p className="mt-2 text-xs italic text-muted-foreground">
              "{instance.completionNote}"
            </p>
          )}

          {/* Reopened info */}
          {instance.reopenedAt && (
            <p className="mt-1 text-xs text-amber-500 dark:text-amber-400">
              Reopened by {instance.reopenedBy?.fullName ?? "admin"} —{" "}
              {new Date(instance.reopenedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 gap-2">
          {!isDone && isSuperAdmin && (
            <button
              onClick={() => onExtend(instance)}
              className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Extend
            </button>
          )}
          {isDone && isSuperAdmin && (
            <button
              onClick={() => onReopen(instance.id)}
              className="rounded-lg border-destructive/40/40 bg-red-500/10 px-3 py-1.5 text-xs text-destructive transition hover:bg-red-500/20"
            >
              Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

export function AdminOpsTasksClient({
  isSuperAdmin,
  actorId,
  opsUsers,
  instances,
  pendingCount,
  completedCount,
  performance,
  perfSummary,
  initialTab,
  initialStatus,
  initialAssigneeFilter,
  initialPerfRange,
  initialFrom,
  initialTo,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [tab, setTab] = useState(initialTab);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [assigneeFilter, setAssigneeFilter] = useState(initialAssigneeFilter);
  const [perfRange, setPerfRange] = useState(initialPerfRange);
  const [customFrom, setCustomFrom] = useState(initialFrom);
  const [customTo, setCustomTo] = useState(initialTo);

  const [showCreate, setShowCreate] = useState(false);
  const [extendTarget, setExtendTarget] = useState<Instance | null>(null);

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams();
    const merged = {
      tab,
      status: statusFilter,
      assigneeId: assigneeFilter,
      range: perfRange,
      from: customFrom,
      to: customTo,
      ...params,
    };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    startTransition(() => router.push(`/app/admin/ops-tasks?${sp.toString()}`));
  }

  function handleReopen(instanceId: string) {
    startTransition(async () => {
      await reopenOpsTaskInstance({ instanceId });
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen pb-16">
      {showCreate && (
        <CreateTaskModal
          opsUsers={opsUsers}
          onClose={() => setShowCreate(false)}
        />
      )}
      {extendTarget && (
        <ExtendModal
          instance={extendTarget}
          onClose={() => setExtendTarget(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold">Ops Tasks</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Assign and track team accountability
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
        >
          + Assign Task
        </button>
      </div>

      {/* Top tabs */}
      <div className="px-6 pt-5">
        <div className="flex w-fit gap-1 rounded-xl border bg-card p-1">
          {[
            { key: "tasks", label: "All Tasks" },
            { key: "performance", label: "Performance" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                navigate({ tab: key });
              }}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                tab === key
                  ? "bg-muted text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pt-5">
        {/* ── TASKS TAB ── */}
        {tab === "tasks" && (
          <div className="flex flex-col gap-4">
            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Status tabs */}
              <div className="flex gap-1 rounded-xl border bg-card p-1">
                {[
                  { key: "pending", label: `Pending (${pendingCount})` },
                  { key: "completed", label: `Completed (${completedCount})` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setStatusFilter(key);
                      navigate({ status: key });
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      statusFilter === key
                        ? "bg-muted text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Assignee filter */}
              <select
                value={assigneeFilter}
                onChange={(e) => {
                  setAssigneeFilter(e.target.value);
                  navigate({ assigneeId: e.target.value });
                }}
                className="rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground outline-none focus:border-ring"
              >
                <option value="">All members</option>
                {opsUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>

            {/* Task list */}
            {instances.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <div className="mb-3 text-3xl">✓</div>
                <p className="text-sm">No {statusFilter} tasks</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {instances.map((inst) => (
                  <TaskCard
                    key={inst.id}
                    instance={inst}
                    isSuperAdmin={isSuperAdmin}
                    onExtend={setExtendTarget}
                    onReopen={handleReopen}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE TAB ── */}
        {tab === "performance" && (
          <div className="flex flex-col gap-5">
            {/* Range selector */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1 rounded-xl border bg-card p-1">
                {[
                  { key: "month", label: "This Month" },
                  { key: "last", label: "Last Month" },
                  { key: "custom", label: "Custom Range" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setPerfRange(key);
                      navigate({ range: key, tab: "performance" });
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      perfRange === key
                        ? "bg-muted text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {perfRange === "custom" && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-lg border bg-card px-3 py-1.5 text-xs outline-none focus:border-ring"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-lg border bg-card px-3 py-1.5 text-xs outline-none focus:border-ring"
                  />
                  <button
                    onClick={() =>
                      navigate({
                        range: "custom",
                        from: customFrom,
                        to: customTo,
                        tab: "performance",
                      })
                    }
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary/90"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: "Tasks Assigned",
                  value: perfSummary.totalAssigned,
                  color: "text-foreground",
                },
                {
                  label: "Completed",
                  value: perfSummary.totalCompleted,
                  color: "text-green-500 dark:text-green-400",
                },
                {
                  label: "On Time",
                  value: perfSummary.totalOnTime,
                  color: "text-primary",
                },
                {
                  label: "Still Pending",
                  value: perfSummary.totalPending,
                  color: "text-amber-500 dark:text-amber-400",
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border bg-card p-4 text-center"
                >
                  <div className={`font-mono text-2xl font-bold ${s.color}`}>
                    {s.value}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Per-person rows */}
            {performance.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <p className="text-sm">No task data for this period.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {performance.map((row) => {
                  const color = scoreColor(row.commitmentPct);
                  const userColor = colorFor(row.user.id);
                  return (
                    <div
                      key={row.user.id}
                      className="flex items-center gap-4 rounded-xl border bg-card p-4 transition hover:border-muted-foreground/40"
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        style={{
                          background: userColor + "25",
                          color: userColor,
                        }}
                      >
                        {initialsOf(row.user.fullName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium">
                              {row.user.fullName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {row.doneCount}/{row.taskCount} tasks ·{" "}
                              {row.lateCount > 0
                                ? `${row.lateCount} late`
                                : "all on time"}
                            </div>
                          </div>
                          <div
                            className="font-mono text-base font-bold"
                            style={{ color }}
                          >
                            {row.commitmentPct}%
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 w-full rounded-full bg-border">
                          <div
                            className="h-1.5 rounded-full transition-all"
                            style={{
                              width: `${row.commitmentPct}%`,
                              background: color,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Score = earned pts ÷ possible pts × 100 &nbsp;·&nbsp; On time = 10 pts · Late ≤2× = 6 pts · Late &gt;2× = 3 pts
            </p>
          </div>
        )}
      </div>
    </div>
  );
}