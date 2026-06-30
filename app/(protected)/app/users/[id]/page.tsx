import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

import { updateMyProfile } from "./actions";
import { ProfileEditCard } from "./_components/profile-edit-card";
import { PendingForm } from "@/components/forms/pending-form";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function isAdminLike(role: Role | undefined) {
  return (
    role === "SUPER_ADMIN" ||
    role === "MANAGER" ||
    role === "BUSINESS_DEVELOPER" ||
    role === "BD"
  );
}

function isWorker(role: Role | undefined) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export default async function UserProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const viewerRole = session.user.role as Role | undefined;
  const viewerId = session.user.id;

  const targetUserId = params.id;

  // Permissions:
  // - Admin-like can view anyone
  // - Workers can only view self
  const canView = isAdminLike(viewerRole) || (viewerId && targetUserId === viewerId);
  if (!canView) redirect("/app?err=forbidden");

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      avatarPath: true,
      email: true,
      username: true,
      fullName: true,
      role: true,
      workerType: true,
      archivedAt: true,
      createdAt: true,
      departments: {
        select: {
          department: { select: { id: true, name: true } },
        },
        orderBy: { department: { name: "asc" } },
      },
    },
  });

  if (!user) redirect("/app?err=user_not_found");

  const isSelf = session.user.id === user.id;

  // Recent assignments (safe “presence” signal)
  const recentAssignments = await prisma.projectAssignment.findMany({
    where: { userId: user.id },
    orderBy: { assignedAt: "desc" },
    take: 12,
    select: {
      id: true,
      assignedAt: true,
      unassignedAt: true,
      project: {
        select: {
          id: true,
          title: true,
          status: true,
          department: { select: { name: true } },
          firstCompletedAt: true,
        },
      },
    },
  });

  // Completed projects count (immutable completion basis)
  const completedCount = await prisma.project.count({
    where: {
      firstCompletedAt: { not: null },
      assignments: { some: { userId: user.id } },
    },
  });

  // Average rating across projects the user worked on (only where rating exists)
  const ratings = await prisma.projectRating.findMany({
    where: {
      project: {
        assignments: { some: { userId: user.id } },
      },
    },
    select: {
      communication: true,
      quality: true,
      speed: true,
      professionalism: true,
    },
    take: 500,
  });

  const ratingCount = ratings.length;
  const avgRating =
    ratingCount === 0
      ? null
      : (() => {
          let sum = 0;
          let denom = 0;

          for (const r of ratings) {
            const parts: number[] = [r.communication, r.quality, r.speed];
            if (typeof r.professionalism === "number") parts.push(r.professionalism);

            const localAvg = parts.reduce((a, b) => a + b, 0) / parts.length;

            sum += localAvg;
            denom += 1;
          }

          return denom ? sum / denom : null;
        })();

  const deptNames = user.departments.map((d) => d.department.name);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      {/* Header */}
      <div className="rounded-2xl border bg-card p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            {/* Avatar */}
            <div className="relative h-16 w-16 overflow-hidden rounded-full border bg-muted shrink-0">
              {user.avatarPath ? (
                <Image
  src={user.avatarPath}
  alt="Avatar"
  fill
  unoptimized
  className="object-cover"
  sizes="64px"
/>

              ) : (
                <div className="h-full w-full grid place-items-center text-sm font-semibold text-muted-foreground">
                  {(user.fullName || user.username || "U")
                    .trim()
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="text-2xl font-semibold">
                {user.fullName || user.username || "User"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                @{user.username || "—"} • {user.email}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border px-3 py-1 text-xs">
                  Role: {user.role}
                </span>
                <span className="rounded-full border px-3 py-1 text-xs">
                  Type: {user.workerType || "—"}
                </span>
                <span
                  className={`rounded-full border px-3 py-1 text-xs ${
                    user.archivedAt ? "border-destructive/40 text-destructive" : ""
                  }`}
                >
                  {user.archivedAt ? "Archived" : "Active"}
                </span>
              </div>

              {deptNames.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {deptNames.map((n) => (
                    <span key={n} className="rounded-full bg-muted px-3 py-1 text-xs">
                      {n}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-4 text-sm text-muted-foreground">
                  No departments assigned.
                </div>
              )}
            </div>
          </div>

          {/* Actions (read-only in 13.3, but give navigation) */}
          <div className="flex gap-2 md:justify-end">
            <Link
              href="/app/projects"
              className="rounded-xl border px-4 py-2 text-sm hover:bg-muted"
            >
              View Projects
            </Link>

            {isAdminLike(viewerRole) ? (
              <Link
                href="/app/admin/users"
                className="rounded-xl border px-4 py-2 text-sm hover:bg-muted"
              >
                Admin Users
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* Edit form (self only) */}
      {isSelf ? (
        <PendingForm
          action={updateMyProfile}
          encType="multipart/form-data"
          className="space-y-4"
        >
          {(pending) => (
            <ProfileEditCard defaultFullName={user.fullName || ""} pending={pending} />
          )}
        </PendingForm>
      ) : null}

      {/* Snapshot */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5">
          <div className="text-sm font-medium">Completed Projects</div>
          <div className="mt-2 text-3xl font-semibold">{completedCount}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            Based on firstCompletedAt (immutable).
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <div className="text-sm font-medium">Average Rating</div>
          <div className="mt-2 text-3xl font-semibold">
            {avgRating == null ? "—" : avgRating.toFixed(2)}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {ratingCount ? `${ratingCount} rating record(s)` : "No ratings yet."}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <div className="text-sm font-medium">Presence</div>
          <div className="mt-2 text-sm text-muted-foreground">
            V1 presence = recent assignments + project involvement.
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Joined: {user.createdAt.toISOString().slice(0, 10)}
          </div>
        </div>
      </div>

      {/* Recent assignments */}
      <div className="rounded-2xl border bg-card p-5 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Recent Assignments</div>
            <div className="text-sm text-muted-foreground">
              Latest 12 assignments for this user.
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border">
          {recentAssignments.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No assignments found.</div>
          ) : (
            <div className="divide-y">
              {recentAssignments.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/app/projects/${a.project.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {a.project.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border px-2 py-0.5">
                        {a.project.department?.name || "—"}
                      </span>
                      <span className="rounded-full border px-2 py-0.5">
                        {a.project.status}
                      </span>
                      {a.project.firstCompletedAt ? (
                        <span className="rounded-full border px-2 py-0.5">
                          First completed:{" "}
                          {a.project.firstCompletedAt.toISOString().slice(0, 10)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground md:text-right">
                    <div>Assigned: {a.assignedAt.toISOString().slice(0, 10)}</div>
                    <div>
                      {a.unassignedAt
                        ? `Unassigned: ${a.unassignedAt.toISOString().slice(0, 10)}`
                        : "Active"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
