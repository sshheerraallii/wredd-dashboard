// app/(protected)/app/worker/projects/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { AnnouncementBanner } from "@/components/app/announcement-banner";
import { AnnouncementBannerDismissable } from "@/components/app/announcement-banner-dismissable";

const prisma = getPrisma();

type Tab = "unassigned" | "active" | "delivered" | "completed" | "cancelled";

function parseTab(input: string | undefined): Tab {
  const t = (input || "").toLowerCase();
  if (t === "unassigned") return "unassigned";
  if (t === "active") return "active";
  if (t === "delivered") return "delivered";
  if (t === "completed") return "completed";
  if (t === "cancelled") return "cancelled";
  return "active";
}

function parsePage(input: string | undefined) {
  const n = Number(input || "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function TabsRow({ tab, q }: { tab: Tab; q: string }) {
  const items: { key: Tab; label: string }[] = [
    { key: "unassigned", label: "Unassigned" },
    { key: "active", label: "Active" },
    { key: "delivered", label: "Delivered" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const hrefFor = (nextTab: Tab) => {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    if (q) params.set("q", q);
    params.set("page", "1");
    return `/app/worker?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <Link
            key={it.key}
            href={hrefFor(it.key)}
            className={[
              "rounded-full px-4 py-2 text-sm border transition",
              active
                ? "bg-muted text-foreground border-muted-foreground/30"
                : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted/20",
            ].join(" ")}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

function Pagination({
  tab,
  q,
  page,
  total,
  pageSize,
}: {
  tab: Tab;
  q: string;
  page: number;
  total: number;
  pageSize: number;
}) {
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  const build = (p: number) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (q) params.set("q", q);
    params.set("page", String(p));
    return `/app/worker/projects?${params.toString()}`;
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-muted-foreground">
        Page {page} • Showing {from}-{to} of {total}
      </div>

      <div className="flex gap-2">
        {hasPrev ? (
          <Button asChild variant="secondary">
            <Link href={build(page - 1)}>Prev</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            Prev
          </Button>
        )}

        {hasNext ? (
          <Button asChild variant="secondary">
            <Link href={build(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function fmtPKR(v: any) {
  if (v == null) return "—";
  const n =
    typeof v === "object" && typeof v.toString === "function"
      ? Number.parseFloat(v.toString())
      : typeof v === "number"
        ? v
        : typeof v === "string"
          ? Number.parseFloat(v)
          : NaN;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(n);
}

function dueInHM(p: {
  deadlineHours: number;
  timerRunning: boolean;
  timerLastResumedAt: Date | null;
  timerAccumulatedSeconds: number;
}) {
  const totalSeconds = Math.max(0, Math.floor((p.deadlineHours || 0) * 3600));
  const base = p.timerAccumulatedSeconds || 0;
  const liveAdd =
    p.timerRunning && p.timerLastResumedAt
      ? Math.max(0, Math.floor((Date.now() - p.timerLastResumedAt.getTime()) / 1000))
      : 0;
  const used = base + liveAdd;
  const remaining = totalSeconds - used;
  const abs = Math.abs(remaining);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  if (remaining < 0) return `Overdue ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

export default async function WorkerProjectsPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string; page?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const userId = session.user.id;

  if (role !== "REMOTE_WORKER" && role !== "ONSITE_EMPLOYEE") {
    redirect("/app?err=forbidden");
  }

  const tab = parseTab(searchParams?.tab);
  const q = (searchParams?.q || "").trim();
  const page = parsePage(searchParams?.page);

  const PAGE_SIZE = 50;
  const skip = (page - 1) * PAGE_SIZE;

  const deptLinks = await prisma.userDepartment.findMany({
    where: { userId },
    select: { departmentId: true },
  });
  const deptIds = deptLinks.map((d) => d.departmentId);

  const where: any = {};

  if (tab === "unassigned") {
    where.status = "UNASSIGNED";
    where.departmentId = { in: deptIds.length ? deptIds : ["__none__"] };
  } else if (tab === "active") {
    where.status = { in: ["IN_PROGRESS", "REVISION"] };
    where.assignments = { some: { userId, unassignedAt: null } };
  } else if (tab === "delivered") {
    where.status = "DELIVERED";
    where.assignments = { some: { userId, unassignedAt: null } };
  } else if (tab === "completed") {
    where.status = "COMPLETED";
    where.assignments = { some: { userId, unassignedAt: null } };
  } else if (tab === "cancelled") {
    // Two cases:
    // 1. Project was fully cancelled while worker was still assigned
    // 2. Worker was individually cancelled-for-worker (outcome=CANCELLED)
    //    — project may still be active for others
    where.OR = [
      {
        status: "CANCELLED",
        assignments: { some: { userId, unassignedAt: null } },
      },
      {
        assignments: { some: { userId, outcome: "CANCELLED" as any } },
      },
    ];
  }

  // Search: when OR is already set, wrap in AND to avoid overriding it
  if (q) {
    if (where.OR) {
      where.AND = [
        { OR: where.OR },
        { title: { contains: q, mode: "insensitive" } },
      ];
      delete where.OR;
    } else {
      where.title = { contains: q, mode: "insensitive" };
    }
  }

  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        title: true,
        status: true,

        deadlineHours: true,
        timerRunning: true,
        timerLastResumedAt: true,
        timerAccumulatedSeconds: true,

        department: { select: { name: true } },

        paymentLines: {
          where: { userId },
          select: { amount: true },
          take: 1,
        },

        // Needed for cancelled tab: detect cancelled-for-worker vs project-cancelled
        assignments: {
          where: { userId },
          select: { outcome: true, unassignedAt: true },
          take: 1,
        },
      },
    }),
  ]);

  return (
    <div className="p-6 space-y-4">
      <AnnouncementBannerDismissable storageKey="wredd:announce:projects">
        <AnnouncementBanner />
      </AnnouncementBannerDismissable>

      <div>
        <h1 className="text-xl font-semibold">Worker Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tabs are status-based. "Active" = IN_PROGRESS + REVISION. Search applies to the current tab.
        </p>
      </div>

      <TabsRow tab={tab} q={q} />

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        action="/app/worker"
        method="get"
      >
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="page" value="1" />

        <input
          name="q"
          defaultValue={q}
          placeholder="Search by title…"
          className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
        />

        <Button type="submit" variant="secondary">
          Search
        </Button>

        {q ? (
          <Button asChild variant="ghost">
            <Link href={`/app/worker?tab=${tab}&page=1`}>Clear</Link>
          </Button>
        ) : null}
      </form>

      <Pagination tab={tab} q={q} page={page} total={total} pageSize={PAGE_SIZE} />

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-12 gap-3 border-b bg-card px-4 py-3 text-xs font-medium text-muted-foreground">
          <div className="col-span-4">Title</div>
          <div className="col-span-2">Price</div>
          <div className="col-span-2">Due in</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Action</div>
        </div>

        {projects.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No projects in this tab.
          </div>
        ) : (
          <div className="divide-y">
            {projects.map((p: any) => {
              const myLine = p.paymentLines?.[0] ?? null;
              const myAssignment = p.assignments?.[0] ?? null;

              // Determine the display status label
              const isCancelledForWorker = myAssignment?.outcome === "CANCELLED";
              const statusLabel = isCancelledForWorker
                ? "Cancelled (for you)"
                : p.status;

              // On cancelled tab: no link to project detail page
              const isCancelledTab = tab === "cancelled";

              return (
                <div
                  key={p.id}
                  className="grid grid-cols-12 gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="col-span-4">
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.department.name}
                    </div>
                  </div>

                  <div className="col-span-2 text-sm">
                    {role === "REMOTE_WORKER"
                      ? myLine
                        ? fmtPKR(myLine.amount)
                        : "—"
                      : "—"}
                  </div>

                  <div className="col-span-2 text-sm">{dueInHM(p)}</div>

                  <div className="col-span-2 text-sm">
                    <span
                      className={
                        isCancelledForWorker
                          ? "text-red-600 dark:text-red-400"
                          : ""
                      }
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="col-span-2 flex justify-end">
                    {isCancelledTab ? (
                      // No link on cancelled tab — access to project detail is blocked
                      <span className="text-xs text-muted-foreground italic">
                        No access
                      </span>
                    ) : (
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/app/projects/${p.id}`}>View project page</Link>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Pagination tab={tab} q={q} page={page} total={total} pageSize={PAGE_SIZE} />
    </div>
  );
}