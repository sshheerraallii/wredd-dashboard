// app/(protected)/app/projects/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { AnnouncementBanner } from "@/components/app/announcement-banner";
import { AnnouncementBannerDismissable } from "@/components/app/announcement-banner-dismissable";
import { markProjectSeenAction } from "@/lib/actions/mark-seen";

const prisma = getPrisma();

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

type Tab = "unassigned" | "active" | "delivered" | "completed" | "cancelled";
type Scope = "all" | "mine";

function parseTab(input: string | undefined): Tab {
  const t = (input || "").toLowerCase();
  if (t === "unassigned") return "unassigned";
  if (t === "active") return "active";
  if (t === "delivered") return "delivered";
  if (t === "completed") return "completed";
  if (t === "cancelled") return "cancelled";
  return "active";
}

function parseScope(input: string | undefined, role: string): Scope {
  const s = (input || "").toLowerCase();
  const defaultScope: Scope = role === "BUSINESS_DEVELOPER" ? "mine" : "all";
  if (s === "all") return "all";
  if (s === "mine") return "mine";
  return defaultScope;
}

function parsePage(input: string | undefined) {
  const n = Number(input || "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function buildStatusWhere(tab: Tab) {
  if (tab === "unassigned") return { status: "UNASSIGNED" as const };
  if (tab === "active") return { status: { in: ["IN_PROGRESS", "REVISION"] as const } };
  if (tab === "delivered") return { status: "DELIVERED" as const };
  if (tab === "completed") return { status: "COMPLETED" as const };
  return { status: "CANCELLED" as const };
}

function statusToBucket(status: string): Tab | null {
  if (status === "UNASSIGNED") return "unassigned";
  if (status === "IN_PROGRESS" || status === "REVISION") return "active";
  if (status === "DELIVERED") return "delivered";
  if (status === "COMPLETED") return "completed";
  if (status === "CANCELLED") return "cancelled";
  return null;
}

function TabsRow({
  tab,
  scope,
  q,
  unreadCounts,
}: {
  tab: Tab;
  scope: Scope;
  q: string;
  unreadCounts: Record<string, number>;
}) {
  const items: { key: Tab; label: string }[] = [
    { key: "unassigned", label: "Unassigned" },
    { key: "active", label: "Active" },
    { key: "delivered", label: "Delivered" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const qp = (nextTab: Tab) => {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    params.set("scope", scope);
    if (q) params.set("q", q);
    params.set("page", "1");
    return `/app/projects?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = tab === it.key;
        const count = unreadCounts[it.key] ?? 0;
        return (
          <Link
            key={it.key}
            href={qp(it.key)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm border transition",
              active
                ? "bg-muted text-foreground border-muted-foreground/30"
                : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted/20",
            ].join(" ")}
          >
            {it.label}
            {count > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function ScopeRow({
  scope,
  tab,
  q,
  role,
}: {
  scope: Scope;
  tab: Tab;
  q: string;
  role: string;
}) {
  const items: { key: Scope; label: string }[] =
    role === "BUSINESS_DEVELOPER"
      ? [
          { key: "mine", label: "My Projects" },
          { key: "all", label: "All Projects" },
        ]
      : [
          { key: "all", label: "All Projects" },
          { key: "mine", label: "Created by me" },
        ];

  const qp = (nextScope: Scope) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("scope", nextScope);
    if (q) params.set("q", q);
    params.set("page", "1");
    return `/app/projects?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = scope === it.key;
        return (
          <Link
            key={it.key}
            href={qp(it.key)}
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
  scope,
  q,
  page,
  total,
  pageSize,
}: {
  tab: Tab;
  scope: Scope;
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
    params.set("scope", scope);
    if (q) params.set("q", q);
    params.set("page", String(p));
    return `/app/projects?${params.toString()}`;
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
          <Button variant="secondary" disabled>Prev</Button>
        )}
        {hasNext ? (
          <Button asChild variant="secondary">
            <Link href={build(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled>Next</Button>
        )}
      </div>
    </div>
  );
}

function looksLikeCuid(s: string) {
  return /^c[a-z0-9]{10,}$/i.test(s);
}

function fmtUSD(v: any) {
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
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
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

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { tab?: string; scope?: string; q?: string; page?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as string;
  const userId = session.user.id as string;

  if (!ALLOWED_ROLES.has(role)) redirect("/app");

  const tab = parseTab(searchParams?.tab);
  const scope = parseScope(searchParams?.scope, role);
  const q = (searchParams?.q || "").trim();
  const page = parsePage(searchParams?.page);

  const PAGE_SIZE = 20;
  const skip = (page - 1) * PAGE_SIZE;

  // ── Scope base (no status, no search) — for tab counts ───────────────────
  const scopeBaseWhere: any = {};
  if (scope === "mine") {
    if (role === "BUSINESS_DEVELOPER") scopeBaseWhere.bdOwnerId = userId;
    else scopeBaseWhere.createdById = userId;
  }

  // ── Full where (status + scope + search) — for current page ──────────────
  const statusWhere = buildStatusWhere(tab);
  const where: any = { ...statusWhere, ...scopeBaseWhere };

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      ...(looksLikeCuid(q) ? [{ id: q }] : []),
    ];
  }

  const canEditFinancials =
    role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";

  // ── Fetch tab unread counts (all statuses, scope only, no search) ─────────
  const allForCounts = await prisma.project.findMany({
    where: scopeBaseWhere,
    select: {
      status: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      lastSeenBy: {
        where: { userId },
        select: { seenAt: true },
        take: 1,
      },
    },
  });

  const unreadCounts: Record<string, number> = {};
  for (const p of allForCounts) {
    const latestActivity = p.messages[0]?.createdAt ?? p.updatedAt;
    const seenAt = p.lastSeenBy[0]?.seenAt;
    const isUnread = !seenAt || latestActivity > seenAt;
    if (!isUnread) continue;
    const bucket = statusToBucket(p.status);
    if (bucket) unreadCounts[bucket] = (unreadCounts[bucket] ?? 0) + 1;
  }

  // ── Current page projects ─────────────────────────────────────────────────
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
        createdAt: true,
        updatedAt: true,
        department: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        bdOwner: { select: { fullName: true } },
        finance: {
          select: {
            workType: true,
            portal: true,
            priceUsd: true,
            platformFeePercent: true,
          },
        },
        // ✅ For unread indicator
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
        lastSeenBy: {
          where: { userId },
          select: { seenAt: true },
          take: 1,
        },
        // ✅ Assigned workers (for admin/manager/BD view)
        assignments: {
          where: { unassignedAt: null },
          select: { user: { select: { fullName: true } } },
        },
      },
    }),
  ]);

  return (
    <div className="p-6 space-y-6">
      <AnnouncementBannerDismissable storageKey="wredd:announce:projects">
        <AnnouncementBanner />
      </AnnouncementBannerDismissable>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Filter by status, scope, and search.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/projects/new">Create Project</Link>
        </Button>
      </div>

      <div className="space-y-3">
        <TabsRow tab={tab} scope={scope} q={q} unreadCounts={unreadCounts} />
        <ScopeRow tab={tab} scope={scope} q={q} role={role} />
      </div>

      <form className="flex flex-col gap-2 sm:flex-row sm:items-center" action="/app/projects" method="get">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="page" value="1" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by title (or paste project id)…"
          className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
        />
        <Button type="submit" variant="secondary">Search</Button>
        {q ? (
          <Button asChild variant="ghost">
            <Link href={`/app/projects?tab=${tab}&scope=${scope}&page=1`}>Clear</Link>
          </Button>
        ) : null}
      </form>

      <Pagination tab={tab} scope={scope} q={q} page={page} total={total} pageSize={PAGE_SIZE} />

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-12 gap-3 border-b bg-card px-4 py-3 text-xs font-medium text-muted-foreground">
          <div className="col-span-4">Title</div>
          <div className="col-span-2">Finance</div>
          <div className="col-span-2">Due in</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Action</div>
        </div>

        {projects.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No projects found.</div>
        ) : (
          <div className="divide-y">
            {projects.map((p: any) => {
              const finance = p.finance ?? null;

              const financeLabel = finance
                ? [
                    finance.workType ?? "—",
                    finance.portal ?? "—",
                    finance.priceUsd != null ? `USD ${fmtUSD(finance.priceUsd)}` : "USD —",
                  ].join(" • ")
                : "Missing finance";

              // ✅ Unread indicator
              const latestActivity = p.messages[0]?.createdAt ?? p.updatedAt;
              const seenAt = p.lastSeenBy[0]?.seenAt;
              const isUnread = !seenAt || latestActivity > seenAt;

              return (
                <div
                  key={p.id}
                  className="grid grid-cols-12 gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="col-span-4 min-w-0">
                    <div className="flex items-center gap-2">
                      {isUnread && (
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
                          title="Unread activity"
                        />
                      )}
                      <div className="text-sm font-medium truncate">{p.title}</div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {p.createdBy.fullName} • {p.department.name}
                      {p.bdOwner?.fullName ? ` • BD: ${p.bdOwner.fullName}` : ""}
                    </div>
                    {canEditFinancials && p.assignments?.length > 0 && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        👤 {p.assignments.map((a: any) => a.user.fullName).join(", ")}
                      </div>
                    )}
                    {isUnread && (
                      <form action={markProjectSeenAction} className="mt-1">
                        <input type="hidden" name="projectId" value={p.id} />
                        <button
                          type="submit"
                          className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                        >
                          Mark as read
                        </button>
                      </form>
                    )}
                  </div>

                  <div className="col-span-2">
                    <div className="text-sm">{financeLabel}</div>
                    {canEditFinancials && finance?.platformFeePercent != null ? (
                      <div className="text-xs text-muted-foreground">
                        Fee: {fmtUSD(finance.platformFeePercent)}%
                      </div>
                    ) : null}
                  </div>

                  <div className="col-span-2 text-sm">{dueInHM(p)}</div>

                  <div className="col-span-2 text-sm">{p.status}</div>

                  <div className="col-span-2 flex justify-end">
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/app/projects/${p.id}`}>View</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Pagination tab={tab} scope={scope} q={q} page={page} total={total} pageSize={PAGE_SIZE} />
    </div>
  );
}
