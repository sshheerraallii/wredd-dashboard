// app/(protected)/app/projects/[id]/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { AssignmentsCard } from "./_components/assignments-card";
import { DeadlineTimer } from "./_components/deadline-timer";
import { DeadlineExtend } from "./_components/deadline-extend";
import { StatusControls } from "./_components/status-controls";
import { ProjectChat } from "./_components/project-chat";
import { RatingCard } from "./_components/rating-card";
import { OnsiteFinalizeCard } from "./_components/onsite-finalize-card";
import { getProjectEstimate } from "@/lib/onsite-points/aggregate";
import { WatchToggle } from "./_components/watch-toggle";
import { DeliverDialog } from "./_components/deliver-dialog";
import { markSeenForUser } from "@/lib/actions/mark-seen";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function isWorker(role: Role | undefined) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

// ✅ PKR assumed (no symbol). Decimal-safe + thousands separators.
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

  return new Intl.NumberFormat("en-PK", {
    maximumFractionDigits: 2,
  }).format(n);
}

// ✅ Decimal-safe numeric conversion
function toNum(v: any) {
  if (v == null) return 0;
  const n =
    typeof v === "object" && typeof v.toString === "function"
      ? Number.parseFloat(v.toString())
      : typeof v === "number"
        ? v
        : typeof v === "string"
          ? Number.parseFloat(v)
          : NaN;
  return Number.isFinite(n) ? n : 0;
}

// ✅ USD formatting
function fmtUSD(v: any) {
  const n = toNum(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const userId = session.user.id;

  const canManage = role === "SUPER_ADMIN" || role === "MANAGER";
  const canExtend = role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";

  // ✅ Edit/delete eligibility (server-side intent; UI only here)
  const canManageProject =
    role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";

  // 1) Fetch minimal project first for access checks
  const base = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      departmentId: true,
    },
  });

  if (!base) {
    redirect("/app/projects/new?err=Project%20not%20found");
  }

  // 2) Enforce view permissions
  if (!canManage && role !== "BUSINESS_DEVELOPER") {
    if (!isWorker(role)) {
      redirect("/app?err=forbidden");
    }

    // Active assignment?
    const assignedToMe = await prisma.projectAssignment.findFirst({
      where: { projectId: base.id, userId, unassignedAt: null },
      select: { id: true },
    });

    if (!assignedToMe) {
      // If not assigned: allow ONLY if project is UNASSIGNED + in my departments
      if (base.status !== "UNASSIGNED") {
        redirect("/app/worker?err=not_assigned");
      }

      const hasDeptAccess = await prisma.userDepartment.findUnique({
        where: {
          userId_departmentId: { userId, departmentId: base.departmentId },
        },
        select: { userId: true },
      });

      if (!hasDeptAccess) {
        redirect("/app/worker?err=not_eligible");
      }
    }
  }

  // ✅ Watch state (adminish only)
  const isAdminish =
    role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER" || role === "BD";

  const watcherRow = isAdminish
    ? await prisma.projectWatcher.findUnique({
        where: { projectId_userId: { projectId: base.id, userId } },
        select: { id: true },
      })
    : null;

  const isWatched = !!watcherRow;

  // ✅ Auto-mark this project as seen when user opens the page
  await markSeenForUser(userId, base.id);

  // 3) Now fetch full project details (safe)
  const project = await prisma.project.findUnique({
    where: { id: base.id },
    select: {
      id: true,
      title: true,
      description: true,

      status: true,
      isSample: true,
      deadlineHours: true,

      timerRunning: true,
      timerLastResumedAt: true,
      timerAccumulatedSeconds: true,

      createdAt: true,
      department: { select: { id: true, name: true } },
      createdBy: { select: { fullName: true, email: true } },

      // legacy fallback only (don’t rely on this for split payments)
      remotePrice: true,

      // ✅ payments: select once, compute “my line” and “total” in JS
      paymentLines: {
        select: { userId: true, amount: true, status: true },
      },

      // ✅ Rating gating fields
      firstCompletedAt: true,
      rating: {
        select: {
          id: true,
          communication: true,
          quality: true,
          speed: true,
          professionalism: true,
          ratedAt: true,
          ratedBy: { select: { id: true, username: true, fullName: true } },
        },
      },

      // ✅ Onsite reference fields + saved data
      onsitePointsManual: true,
      classBasePointsAtFirstCompletion: true,
      extraPoints: true,
      projectClassDefinition: { select: { class: true, basePoints: true } },

      onsiteCredits: {
        select: {
          userId: true,
          points: true,
          user: { select: { fullName: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      onsiteRating: {
        select: {
          id: true,
          m1: true,
          m2: true,
          m3: true,
          m4: true,
          m5: true,
          ratedAt: true,
          ratedBy: { select: { fullName: true } },
        },
      },

      // Needed for canPostChat + onsite detection
      assignments: {
        where: { unassignedAt: null },
        select: {
          userId: true,
          user: {
            select: {
              fullName: true,
              workerType: true,
            },
          },
        },
      },

      // ✅ Chat messages: ProjectMessage.createdBy (NOT user)
      messages: {
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          type: true,
          content: true,
          linkUrl: true,
          meta: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
              role: true,
            },
          },
        },
      },

      // ✅ Financials (gated in UI)
      bdOwner: { select: { id: true, fullName: true, username: true } },
      finance: {
        select: {
          clientName: true,
          clientUsername: true,
          workType: true,
          portal: true,
          priceUsd: true,
          platformFeePercent: true,
          platformFeeUsd: true, // ✅ add this
          allowedHours: true,
        },
      },
    },
  });

  if (!project) {
    redirect("/app/projects/new?err=Project%20not%20found");
  }

  // Compute canPostChat server-side
  const isAdminLike =
    role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER" || role === "BD";

  const isWorkerRole = role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";

  const assignedUserIds = new Set(project.assignments?.map((a: any) => a.userId) ?? []);
  const isAssigned = assignedUserIds.has(userId);

  const canPostChat = isAdminLike || (isWorkerRole && isAssigned);

  // ✅ Delivery gating (Step 2B)
  const canDeliver =
    isWorkerRole && isAssigned && (project.status === "IN_PROGRESS" || project.status === "REVISION");

  // ✅ Workers should NOT be able to set DELIVERED directly
  const showStatusControls = isAdminLike;

  // ✅ Onsite finalization permissions (server-side)
  const isAdminLikeForOnsite =
    role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER";

  const onsiteAssigned = project.assignments.filter(
    (a: any) => a.user.workerType === "ONSITE_VIDEO_EDITOR" || a.user.workerType === "ONSITE_ANIMATOR"
  );

  // ✅ Remote detection (so onsite projects don't show remote rating UI)
  const hasRemoteWork =
    (project.paymentLines?.length ?? 0) > 0 ||
    project.assignments.some((a: any) => String(a.user.workerType ?? "").startsWith("REMOTE_"));

  // ✅ Remote rating is ONLY for remote projects (BD only)
  const canBDRate =
    role === "BUSINESS_DEVELOPER" &&
    hasRemoteWork &&
    project.status === "COMPLETED" &&
    !!project.firstCompletedAt &&
    !project.rating;

  const canFinalizeOnsite =
    isAdminLikeForOnsite &&
    project.status === "COMPLETED" &&
    !!project.firstCompletedAt &&
    !project.onsiteRating &&
    onsiteAssigned.length > 0;

  // ✅ Suggested points label (server-side)
  const suggestedPoints =
    project.onsitePointsManual ??
    (project.classBasePointsAtFirstCompletion ?? project.projectClassDefinition?.basePoints ?? null);

  const extra = project.extraPoints ?? 0;

  const suggestedLabel =
    suggestedPoints === null
      ? "—"
      : project.onsitePointsManual != null
        ? `${suggestedPoints} pts (manual)`
        : `${suggestedPoints + extra} pts (class${extra ? ` +${extra}` : ""})`;

  // ── Estimated points for THIS project (live, pre-finalization) ──
  // Admins/BD see every onsite worker's estimate; an onsite worker sees only
  // their own line. Skipped entirely for non-onsite projects / non-eligible viewers.
  const canSeeEstimate = isAdminLike || role === "ONSITE_EMPLOYEE";
  const projectEstimate =
    canSeeEstimate && onsiteAssigned.length > 0
      ? await getProjectEstimate(project.id)
      : null;
  const estimateLines =
    projectEstimate?.eligible
      ? isAdminLike
        ? projectEstimate.lines
        : projectEstimate.lines.filter((l) => l.userId === userId)
      : [];

  // ✅ Financials gate (SUPER_ADMIN / MANAGER / BUSINESS_DEVELOPER / BD)
  const canViewFinancials =
    role === "SUPER_ADMIN" || role === "MANAGER" || role === "BUSINESS_DEVELOPER" || role === "BD";

  // ✅ Compute platform fee USD (prefer DB, else compute from percent)
  const priceUsd = toNum((project as any).finance?.priceUsd);
  const feePercent = toNum((project as any).finance?.platformFeePercent);
  const feeUsdDbRaw = (project as any).finance?.platformFeeUsd ?? null;
  const feeUsdDb = feeUsdDbRaw == null ? null : toNum(feeUsdDbRaw);

  const platformFeeUsd =
    feeUsdDb != null && feeUsdDb > 0 ? feeUsdDb : priceUsd > 0 && feePercent > 0 ? (priceUsd * feePercent) / 100 : 0;

  // Normalize message DTOs to what UI expects (ISO + createdBy)
  const messages = project.messages.map((m: any) => ({
    id: m.id,
    type: m.type,
    content: m.content ?? "",
    linkUrl: m.linkUrl ?? null,
    meta: m.meta ?? null,
    createdAt: m.createdAt.toISOString(),
    createdBy: m.createdBy
      ? {
          id: m.createdBy.id,
          fullName: m.createdBy.fullName,
          username: m.createdBy.username,
          email: m.createdBy.email,
          role: m.createdBy.role,
        }
      : null,
  }));

  // Active assignments (only current assigned workers)
  const assignedRows = await prisma.projectAssignment.findMany({
    where: { projectId: project.id, unassignedAt: null },
    select: {
      userId: true,
      allocatedHours: true,
      user: { select: { fullName: true } },
    },
    orderBy: { assignedAt: "asc" },
  });

  const assigned = assignedRows.map((a) => ({
    userId: a.userId,
    fullName: a.user.fullName,
    allocatedHours: a.allocatedHours ?? null,
  }));

  // Only load assignable workers if manager/admin
  const workers = canManage
    ? (await prisma.user.findMany({
        where: {
          archivedAt: null,
          role: { in: ["REMOTE_WORKER", "ONSITE_EMPLOYEE"] },
        },
        select: { id: true, fullName: true, role: true, workerType: true },
        orderBy: { fullName: "asc" },
      })).map((w) => ({
        ...w,
        role: w.role as "REMOTE_WORKER" | "ONSITE_EMPLOYEE",
      }))
    : [];

  // Onsite rating avg
  const onsiteAvg = project.onsiteRating
    ? (project.onsiteRating.m1 +
        project.onsiteRating.m2 +
        project.onsiteRating.m3 +
        project.onsiteRating.m4 +
        project.onsiteRating.m5) /
      5
    : null;

  /**
   * ✅ PRICE LOGIC
   * Remote worker => show their own line
   * Manager/SuperAdmin => show total remote payout (sum of lines)
   */
  const showRemotePrice = role === "REMOTE_WORKER";
  const isManagerOrSA = role === "SUPER_ADMIN" || role === "MANAGER";

  const lines = project.paymentLines ?? [];

  const myLine = lines.find((l: any) => l.userId === userId && l.status !== "VOIDED") ?? null;

  const totalRemote = lines
    .filter((l: any) => l?.status !== "VOIDED")
    .reduce((sum: number, l: any) => {
      const n = Number.parseFloat(l?.amount?.toString?.() ?? String(l?.amount ?? ""));
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

  const showPriceBlock = showRemotePrice || isManagerOrSA;

  const priceLabel = showRemotePrice
    ? myLine
      ? fmtPKR(myLine.amount)
      : "Not assigned"
    : isManagerOrSA
      ? totalRemote > 0
        ? fmtPKR(totalRemote)
        : "—"
      : "—";

  // Onsite worker's own allocated hours (visible to them on the project page)
  const myAllocatedHours =
    role === "ONSITE_EMPLOYEE" && isAssigned
      ? (assignedRows.find((a) => a.userId === userId)?.allocatedHours ?? null)
      : null;




  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{project.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.department.name} • {project.status} • {project.deadlineHours}h
              {(project as any).isSample && (
                <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
                  SAMPLE
                </span>
              )}
            </p>

            {showPriceBlock ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  {showRemotePrice ? "Your price" : "Total remote price"}
                </div>
                <div className="text-sm font-semibold">{priceLabel}</div>
              </div>
            ) : null}
          </div>

          {/* ✅ Edit link (top-right) */}
          {canManageProject ? (
            <Link className="text-sm underline" href={`/app/projects/${project.id}/edit`}>
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      <DeadlineTimer
        deadlineHours={project.deadlineHours}
        timerRunning={project.timerRunning}
        timerLastResumedAt={project.timerLastResumedAt ? project.timerLastResumedAt.toISOString() : null}
        timerAccumulatedSeconds={project.timerAccumulatedSeconds}
      />

      {showStatusControls ? (
         <StatusControls
 projectId={project.id}
role={role}
status={project.status}
activeWorkers={assigned}
deadlineHours={project.deadlineHours ?? null}
/>
      ) : null}

      {canDeliver ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Delivery</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Submit a Google Drive/Docs link and delivery notes. This will mark the project as DELIVERED.
              </div>
            </div>
            <DeliverDialog projectId={project.id} />
          </div>
        </div>
      ) : null}

    {myAllocatedHours != null ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-medium">Your allocated hours</div>
          <div className="mt-1 text-2xl font-semibold">{myAllocatedHours} hrs</div>
          <div className="text-xs text-muted-foreground mt-1">Hours budgeted for you on this project</div>
        </div>
      ) : null}

      <WatchToggle projectId={project.id} role={role} isWatched={isWatched} />

      {/* ✅ Financials (admins + BD only) */}
      {canViewFinancials ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-medium">Financials</div>

          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Client name</span>
              <span className="font-medium">{(project as any).finance?.clientName ?? "—"}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Client username</span>
              <span className="font-medium">{(project as any).finance?.clientUsername ?? "—"}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">BD owner</span>
              <span className="font-medium">{(project as any).bdOwner?.fullName ?? "—"}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Work type</span>
              <span className="font-medium">{(project as any).finance?.workType ?? "—"}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Portal</span>
              <span className="font-medium">{(project as any).finance?.portal ?? "—"}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Price (USD)</span>
              <span className="font-medium">
                {(project as any).isSample
                  ? <span className="text-yellow-600 dark:text-yellow-400 font-semibold">Sample (unpaid)</span>
                  : (project as any).finance?.priceUsd ? fmtUSD((project as any).finance.priceUsd) : "—"}
              </span>
            </div>

            {!(project as any).isSample && (
              <>
                {/* ✅ Correct fields */}
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Platform fee (%)</span>
                  <span className="font-medium">
                    {feePercent > 0 ? `${feePercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%` : "—"}
                  </span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Platform fee (USD)</span>
                  <span className="font-medium">{platformFeeUsd > 0 ? fmtUSD(platformFeeUsd) : "—"}</span>
                </div>
              </>
            )}

            {(project as any).finance?.workType === "ONSITE" ? (
              <div className="flex justify-between gap-4">
               <span className="text-muted-foreground">Total allocated hours</span>
                <span className="font-medium">{(project as any).finance.allowedHours ?? "—"}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {canBDRate ? <RatingCard projectId={project.id} /> : null}

      {hasRemoteWork && project.rating ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-medium">Rating (submitted)</div>
          <div className="mt-3 grid gap-2 text-sm">
            <div>Communication: {project.rating.communication}/5</div>
            <div>Quality: {project.rating.quality}/5</div>
            <div>Speed: {project.rating.speed}/5</div>
            {project.rating.professionalism ? <div>Professionalism: {project.rating.professionalism}/5</div> : null}
            <div className="text-xs text-muted-foreground">
              Rated at: {new Date(project.rating.ratedAt).toLocaleString()}
            </div>
          </div>
        </div>
      ) : null}

      {project.onsiteRating ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Onsite Rating (submitted)</div>
              <div className="mt-2 text-sm">
                Average: <span className="font-medium">{onsiteAvg ? onsiteAvg.toFixed(1) : "—"}</span> / 5
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Rated by {project.onsiteRating.ratedBy.fullName} •{" "}
                {new Date(project.onsiteRating.ratedAt).toLocaleString()}
              </div>
            </div>

            <details className="group">
              <summary
                className={[
                  "cursor-pointer select-none list-none",
                  "rounded-md border px-3 py-2 text-sm",
                  "hover:bg-muted",
                  "focus:outline-none focus:ring-2 focus:ring-primary/40",
                ].join(" ")}
              >
                <span className="group-open:hidden">View details</span>
                <span className="hidden group-open:inline">Hide details</span>
              </summary>

              <div className="mt-3 rounded-lg border bg-background/40 p-3 text-sm">
                <div className="grid gap-1">
                  <div className="flex justify-between">
                    <span>Quality</span>
                    <span className="font-medium">{project.onsiteRating.m1}/5</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Speed</span>
                    <span className="font-medium">{project.onsiteRating.m2}/5</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Communication</span>
                    <span className="font-medium">{project.onsiteRating.m3}/5</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Professionalism</span>
                    <span className="font-medium">{project.onsiteRating.m4}/5</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accuracy</span>
                    <span className="font-medium">{project.onsiteRating.m5}/5</span>
                  </div>
                </div>
              </div>
            </details>
          </div>

          {project.onsiteCredits?.length ? (
            <div className="mt-4">
              <div className="text-sm font-medium">Onsite Points (credited)</div>
              <div className="mt-2 grid gap-1 text-sm">
                {project.onsiteCredits.map((c: any) => (
                  <div key={c.userId} className="flex items-center justify-between">
                    <div>{c.user.fullName}</div>
                    <div className="font-medium">{c.points} pts</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {estimateLines.length > 0 ? (
        <div className="rounded-lg border border-dashed p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">
                Estimated Points (live)
              </div>
              <div className="text-xs text-muted-foreground">
                Subject to change · finalizes when this project completes
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {projectEstimate?.status === "DELIVERED"
                ? "Delivered · 100%"
                : projectEstimate?.status === "REVISION"
                  ? "In revision · 70%"
                  : "In progress · 30%"}
            </div>
          </div>

          {projectEstimate?.fxMissing ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
              No FX rate is set for this month yet, so these estimates are approximate.
            </div>
          ) : null}

          <div className="space-y-1.5">
            {estimateLines.map((l) => (
              <div
                key={l.userId}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.fullName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {l.allocatedHours != null ? `${l.allocatedHours}h allocated` : "no hours set"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold">
                    {!l.computable
                      ? "—"
                      : l.estimatedPoints === 0
                        ? "<1 pt"
                        : `${l.estimatedPoints} pt${l.estimatedPoints === 1 ? "" : "s"}`}
                  </div>
                  {l.computable && l.basePoints > 0 ? (
                    <div className="text-[11px] text-muted-foreground">
                      of {l.basePoints} full
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canFinalizeOnsite ? (
        <OnsiteFinalizeCard
          projectId={project.id}
          onsiteWorkers={onsiteAssigned.map((a: any) => ({
            userId: a.userId,
            fullName: a.user.fullName,
          }))}
          suggestedLabel={suggestedLabel}
        />
      ) : null}

      <DeadlineExtend projectId={project.id} canExtend={canExtend} />

      <AssignmentsCard projectId={project.id} canManage={canManage} workers={workers} assigned={assigned} />

      {project.description ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm whitespace-pre-wrap">{project.description}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No description</p>
      )}

      <ProjectChat projectId={project.id} canPost={canPostChat} currentUserId={session.user.id} messages={messages} />

      <div className="text-xs text-muted-foreground">
        Created by {project.createdBy.fullName} • {new Date(project.createdAt).toLocaleString()}
      </div>
    </div>
  );
}