import Link from "next/link";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { requireRole } from "@/lib/guards";
import { updateUserDepartments, updateUserPerformance } from "../actions";
import { UserDangerZone } from "./_components/user-danger-zone";
import { OnsiteRateField } from "./_components/onsite-rate-field";
import {
  getOnsiteOverheadSettings,
  overheadForWorkerType,
  sellableHoursPerMonth,
} from "@/lib/onsite-points/overhead-settings";

const prisma = getPrisma();

export default async function UserEditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { ok?: string; err?: string };
}) {
  await requireAdmin();

  const userId = params.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      workerType: true,
      archivedAt: true,

     // performance fields
      targetMonthlyPoints: true,
      onsiteHourRatePkr: true,
      joinedAt: true,
      createdAt: true,
    },
  });

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-3">
        <p className="text-sm">User not found.</p>
        <Link className="underline text-sm" href="/app/admin">
          Back
        </Link>
      </div>
    );
  }

  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const overheadSettings = await getOnsiteOverheadSettings();
  const sellableHours = sellableHoursPerMonth(overheadSettings);
  const workerOverhead = overheadForWorkerType(user.workerType, overheadSettings);

  const existing = await prisma.userDepartment.findMany({
    where: { userId },
    select: { departmentId: true },
  });

  const selected = new Set(existing.map((x) => x.departmentId));

  async function onSave(formData: FormData) {
    "use server";
    await requireRole(["SUPER_ADMIN", "MANAGER"]);
    return updateUserDepartments(userId, formData);
  }

  async function onSavePerformance(formData: FormData) {
    "use server";
    await requireRole(["SUPER_ADMIN", "MANAGER"]);
    return updateUserPerformance(userId, formData);
  }

  const ok = searchParams?.ok;
  const err = searchParams?.err;

  const joinedDefault =
    user.joinedAt ? new Date(user.joinedAt).toISOString().slice(0, 10) : "";

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit User</h1>
        <Link className="underline text-sm" href="/app/admin">
          Back
        </Link>
      </div>

      <div className="border rounded-lg p-4 text-sm space-y-1">
        <div>
          <span className="text-muted-foreground">Name:</span> {user.fullName}
        </div>
        <div>
          <span className="text-muted-foreground">Email:</span> {user.email}
        </div>
        <div>
          <span className="text-muted-foreground">Role:</span> {user.role}
        </div>
        <div>
          <span className="text-muted-foreground">Worker Type:</span>{" "}
          {user.workerType ?? "-"}
        </div>
        <div>
          <span className="text-muted-foreground">Archived:</span>{" "}
          {user.archivedAt ? "Yes" : "No"}
        </div>
      </div>

      {ok ? <p className="text-sm text-green-600">{ok}</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      {/* Departments */}
      <form action={onSave} className="space-y-4">
        <div className="border rounded-lg p-4">
          <h2 className="font-medium mb-3">Departments</h2>

          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No departments found. Create them first.
            </p>
          ) : (
            <div className="space-y-2">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="departmentIds"
                    value={d.id}
                    defaultChecked={selected.has(d.id)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground">
          Save Departments
        </button>
      </form>

      {/* Performance Target (before DangerZone) */}
      <form action={onSavePerformance} className="space-y-4">
        <div className="border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">Onsite performance</h2>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Monthly target points</label>
              <input
                name="targetMonthlyPoints"
                type="number"
                min={0}
                defaultValue={user.targetMonthlyPoints ?? 0}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
              <div className="text-xs text-muted-foreground">
                Used for onsite accuracy (prorated if joined mid-month).
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Joined at</label>
              <input
                name="joinedAt"
                type="date"
                defaultValue={joinedDefault}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
              <div className="text-xs text-muted-foreground">
                Controls prorating. Keep createdAt separate for audit/history.
              </div>
            </div>
          </div>

       {user.role === "ONSITE_EMPLOYEE" ? (
            <OnsiteRateField
              defaultRate={user.onsiteHourRatePkr ?? null}
              workerType={user.workerType ?? null}
              overheadPkrPerHour={workerOverhead}
              sellableHours={sellableHours}
              workingDays={overheadSettings.workingDaysPerMonth}
              effectiveHours={overheadSettings.effectiveHoursPerDay}
            />
          ) : null}

          <div className="text-xs text-muted-foreground">
            Created: {new Date(user.createdAt).toLocaleString()}
          </div>
        </div>

        <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground">
          Save Performance
        </button>
      </form>

      <UserDangerZone
        userId={user.id}
        isArchived={!!user.archivedAt}
        isSuperAdmin={user.role === "SUPER_ADMIN"}
      />
    </div>
  );
}
