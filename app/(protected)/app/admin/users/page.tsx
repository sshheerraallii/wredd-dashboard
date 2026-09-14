import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

const TABS = [
  { key: "active", label: "All active" },
  { key: "animators", label: "Animators" },
  { key: "editors", label: "Video Editors" },
  { key: "ops", label: "Operations" },
  { key: "web", label: "Web Development" },
  { key: "staff", label: "BD & Management" },
  { key: "archived", label: "Archived" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Archived users are split out entirely — they are ex-staff and clutter every
 * other view. Every tab except "archived" shows only active people.
 */
function whereForTab(tab: TabKey) {
  const active = { archivedAt: null };
  switch (tab) {
    case "archived":
      return { archivedAt: { not: null } };
    case "animators":
      return {
        ...active,
        workerType: { in: ["ONSITE_ANIMATOR", "REMOTE_ANIMATOR"] as never[] },
      };
    case "editors":
      return {
        ...active,
        workerType: {
          in: ["ONSITE_VIDEO_EDITOR", "REMOTE_VIDEO_EDITOR"] as never[],
        },
      };
    case "ops":
      return { ...active, workerType: "OPERATIONS" as never };
    case "web":
      return { ...active, workerType: "WEB_DEVELOPMENT" as never };
    case "staff":
      return {
        ...active,
        role: {
          in: ["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER", "BD"] as never[],
        },
      };
    default:
      return active;
  }
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const viewerRole = session.user.role as Role | undefined;
  if (viewerRole !== "SUPER_ADMIN" && viewerRole !== "MANAGER") {
    redirect("/app?err=forbidden");
  }

  const rawTab = Array.isArray(searchParams?.tab)
    ? searchParams.tab[0]
    : searchParams?.tab;
  const tab: TabKey = (TABS.find((t) => t.key === rawTab)?.key ??
    "active") as TabKey;

  const counts = await Promise.all(
    TABS.map((t) => prisma.user.count({ where: whereForTab(t.key) as never }))
  );

  const users = await prisma.user.findMany({
    where: whereForTab(tab) as never,
    select: {
      id: true,
      email: true,
      username: true,
      fullName: true,
      role: true,
      workerType: true,
      archivedAt: true,
      createdAt: true,
      departments: { select: { departmentId: true } },
    },
    orderBy: [{ archivedAt: "desc" }, { fullName: "asc" }],
    take: 200,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Edit users and assign departments. Archived users are listed
            separately.
          </p>
        </div>

        <Button asChild>
          <Link href="/app/admin/users/new">Create User</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t, i) => {
          const isActive = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/app/admin/users?tab=${t.key}`}
              className={`rounded-xl border px-3 py-1.5 text-sm ${
                isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {t.label}
              <span
                className={`ml-2 text-xs ${
                  isActive ? "opacity-80" : "text-muted-foreground"
                }`}
              >
                {counts[i]}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 px-4 text-left font-medium">User</th>
                <th className="py-3 px-4 text-left font-medium">Role</th>
                <th className="py-3 px-4 text-left font-medium">Worker Type</th>
                <th className="py-3 px-4 text-left font-medium">Departments</th>
                <th className="py-3 px-4 text-left font-medium">State</th>
                <th className="py-3 px-4 text-right font-medium">Actions</th>
              </tr>
            </thead>

            <tbody>
              {users.map((u) => {
                const isProtectedSA = u.role === "SUPER_ADMIN";
                const managerCannotEditSA = viewerRole === "MANAGER" && isProtectedSA;

                return (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-3 px-4">
                      <div className="font-medium">
                        {u.username}{" "}
                        <span className="text-muted-foreground">— {u.fullName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span>{u.role}</span>
                        {isProtectedSA ? (
                          <span className="rounded-md border px-2 py-0.5 text-xs">Protected</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="py-3 px-4">{u.workerType ?? "-"}</td>

                    <td className="py-3 px-4">{u.departments.length ? u.departments.length : 0}</td>

                    <td className="py-3 px-4">
                      {u.archivedAt ? (
                        <>
                          <span className="text-muted-foreground">Archived</span>
                          <span className="block text-xs text-muted-foreground">
                            {new Date(u.archivedAt).toISOString().slice(0, 10)}
                          </span>
                        </>
                      ) : (
                        "Active"
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
  <div className="flex justify-end gap-2">
    <Button asChild size="sm" variant="outline">
      <Link href={`/app/users/${u.id}`}>Profile</Link>
    </Button>

    {managerCannotEditSA ? (
      <Button size="sm" variant="secondary" disabled>
        Edit
      </Button>
    ) : (
      <Button asChild size="sm" variant="secondary">
        <Link href={`/app/admin/users/${u.id}/edit`}>Edit</Link>
      </Button>
    )}
  </div>
</td>

                  </tr>
                );
              })}

              {!users.length && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No users in this tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
