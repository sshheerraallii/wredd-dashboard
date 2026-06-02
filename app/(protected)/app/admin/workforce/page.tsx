// app/(protected)/app/admin/workforce/page.tsx
export const runtime = "nodejs";

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getMultipleWorkerStats } from "@/lib/worker-stats/assignments";
import {
  computeMultipleCommitmentIndexes,
} from "@/lib/worker-stats/commitment-index";
import { CommitmentBadge } from "@/components/app/commitment-index";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

type FilterKey = "all" | "remote" | "onsite" | "video_editors" | "animators";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",           label: "All Workers"    },
  { key: "remote",        label: "Remote"         },
  { key: "onsite",        label: "Onsite"         },
  { key: "video_editors", label: "Video Editors"  },
  { key: "animators",     label: "Animators"      },
];

function parseFilter(v?: string): FilterKey {
  if (
    v === "remote" ||
    v === "onsite" ||
    v === "video_editors" ||
    v === "animators"
  )
    return v;
  return "all";
}

function buildWhere(filter: FilterKey) {
  const base = { archivedAt: null };

  if (filter === "remote") {
    return { ...base, role: "REMOTE_WORKER" as any };
  }
  if (filter === "onsite") {
    return { ...base, role: "ONSITE_EMPLOYEE" as any };
  }
  if (filter === "video_editors") {
    return {
      ...base,
      role: { in: ["REMOTE_WORKER", "ONSITE_EMPLOYEE"] as any[] },
      workerType: {
        in: ["REMOTE_VIDEO_EDITOR", "ONSITE_VIDEO_EDITOR"] as any[],
      },
    };
  }
  if (filter === "animators") {
    return {
      ...base,
      role: { in: ["REMOTE_WORKER", "ONSITE_EMPLOYEE"] as any[] },
      workerType: {
        in: ["REMOTE_ANIMATOR", "ONSITE_ANIMATOR"] as any[],
      },
    };
  }
  // "all"
  return {
    ...base,
    role: { in: ["REMOTE_WORKER", "ONSITE_EMPLOYEE"] as any[] },
  };
}

function workerTypeLabel(wt: string | null): string {
  if (!wt) return "—";
  return wt
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysSince(date: Date, now: Date): number {
  return Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function LastAssignedCell({
  days,
}: {
  days: number | null;
}) {
  if (days === null)
    return (
      <span className="inline-flex items-center rounded-full border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
        Never assigned
      </span>
    );
  if (days === 0)
    return <span className="text-xs text-muted-foreground">Today</span>;
  if (days <= 7)
    return (
      <span className="text-xs text-green-700 dark:text-green-400 font-medium">{days}d ago</span>
    );
  if (days <= 14)
    return (
      <span className="text-xs text-amber-600 font-medium">{days}d ago</span>
    );
  return (
    <span className="text-xs text-red-600 font-medium">{days}d ago</span>
  );
}

export default async function WorkforcePage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app/projects?err=forbidden");
  }

  const filter = parseFilter(searchParams?.filter);
  const now = new Date();

  // ── Fetch workers ───────────────────────────────────────────────────────
  const workers = await prisma.user.findMany({
    where: buildWhere(filter),
    select: {
      id: true,
      fullName: true,
      workerType: true,
      role: true,
      assignments: {
        select: {
          assignedAt: true,
          outcome: true,
          project: {
            select: {
              id: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: { assignedAt: "desc" },
      },
    },
    orderBy: { fullName: "asc" },
  });

  // ── Batch Commitment Index ───────────────────────────────────────────────
  const workerIds = workers.map((w) => w.id);
  const statsMap = await getMultipleWorkerStats(workerIds);
  const indexMap = computeMultipleCommitmentIndexes(statsMap);

  // ── Build display rows ───────────────────────────────────────────────────
  const rows = workers.map((w) => {
    // Active = currently on an IN_PROGRESS or REVISION project
    const activeProjects = w.assignments
      .filter(
        (a) =>
          a.outcome === "ACTIVE" &&
          (a.project.status === "IN_PROGRESS" ||
            a.project.status === "REVISION")
      )
      .map((a) => ({
        id: a.project.id,
        title: a.project.title,
        status: a.project.status,
      }));

    // Most recent assignment (any outcome) — assignments already sorted desc
    const lastAssignedAt =
      w.assignments.length > 0
        ? new Date(w.assignments[0].assignedAt)
        : null;

    return {
      id: w.id,
      fullName: w.fullName,
      workerType: w.workerType as string | null,
      activeProjects,
      isUnassigned: activeProjects.length === 0,
      daysSinceLastAssignment: lastAssignedAt
        ? daysSince(lastAssignedAt, now)
        : null,
      commitmentIndex: indexMap.get(w.id) ?? null,
    };
  });

  // Unassigned workers float to the top
  rows.sort((a, b) => {
    if (a.isUnassigned && !b.isUnassigned) return -1;
    if (!a.isUnassigned && b.isUnassigned) return 1;
    return a.fullName.localeCompare(b.fullName);
  });

  const totalCount = rows.length;
  const unassignedCount = rows.filter((r) => r.isUnassigned).length;
  const activeCount = totalCount - unassignedCount;

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-semibold">Workforce</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Active workers only · archived profiles excluded
        </p>
      </div>

      {/* ── Filter pills ── */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/app/admin/workforce?filter=${f.key}`}
            className={[
              "rounded-full border px-3 py-1 text-sm transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted",
            ].join(" ")}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total Workers</div>
          <div className="text-2xl font-semibold mt-1">{totalCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {FILTERS.find((f) => f.key === filter)?.label}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Active on Project</div>
          <div className="text-2xl font-semibold mt-1 text-green-700 dark:text-green-400">
            {activeCount}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            IN_PROGRESS or REVISION
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Needs Follow-up</div>
          <div
            className={[
              "text-2xl font-semibold mt-1",
              unassignedCount > 0
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground",
            ].join(" ")}
          >
            {unassignedCount}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            No active project right now
          </div>
        </div>
      </div>

      {/* ── Workers table ── */}
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs text-muted-foreground">
              <th className="py-3 px-4 text-left font-medium">Worker</th>
              <th className="py-3 px-4 text-left font-medium">Type</th>
              <th className="py-3 px-4 text-left font-medium">
                Active Projects
              </th>
              <th className="py-3 px-4 text-left font-medium">
                Last Assigned
              </th>
              <th className="py-3 px-4 text-left font-medium">Commitment</th>
              <th className="py-3 px-4 text-left font-medium">Status</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={[
                  "border-b last:border-b-0 transition-colors",
                  row.isUnassigned
                    ? "bg-red-50/50 dark:bg-red-950/10"
                    : "hover:bg-muted/30",
                ].join(" ")}
              >
                {/* Worker name → profile */}
                <td className="py-3 px-4">
                  <Link
                    href={`/app/users/${row.id}`}
                    className="font-medium hover:underline underline-offset-2"
                  >
                    {row.fullName}
                  </Link>
                </td>

                {/* Worker type */}
                <td className="py-3 px-4 text-muted-foreground text-xs">
                  {workerTypeLabel(row.workerType)}
                </td>

                {/* Active projects */}
                <td className="py-3 px-4">
                  {row.activeProjects.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="space-y-1">
                      {row.activeProjects.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5">
                          <span
                            className={[
                              "h-1.5 w-1.5 rounded-full flex-shrink-0",
                              p.status === "REVISION"
                                ? "bg-amber-500"
                                : "bg-green-500",
                            ].join(" ")}
                          />
                          <Link
                            href={`/app/projects/${p.id}`}
                            className="text-xs hover:underline underline-offset-2 truncate max-w-[180px]"
                          >
                            {p.title}
                          </Link>
                          {p.status === "REVISION" && (
                            <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 border border-amber-200 rounded px-1">
                              REV
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </td>

                {/* Last assigned */}
                <td className="py-3 px-4">
                  <LastAssignedCell
                    days={row.daysSinceLastAssignment}
                  />
                </td>

                {/* Commitment index */}
                <td className="py-3 px-4">
                  {row.commitmentIndex ? (
                    <CommitmentBadge index={row.commitmentIndex} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                {/* Status badge */}
                <td className="py-3 px-4">
                  {row.isUnassigned ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      Needs Follow-up
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Active
                    </span>
                  )}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No workers found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}