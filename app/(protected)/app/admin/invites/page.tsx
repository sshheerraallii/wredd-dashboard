import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createInvite, revokeInvite, resendInvite } from "./actions";

const prisma = getPrisma();

export default async function AdminInvitesPage({
  searchParams,
}: {
  searchParams: { ok?: string; err?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");

  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const invites = await prisma.userInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      workerType: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      departments: { select: { department: { select: { id: true, name: true } } } },
    },
  });

  const ok = searchParams?.ok ? decodeURIComponent(searchParams.ok) : null;
  const err = searchParams?.err ? decodeURIComponent(searchParams.err) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Invites</h1>
        <p className="text-sm text-muted-foreground">Invite users by email. No public signups.</p>
        {ok ? <div className="mt-3 rounded-md border p-3 text-sm">{ok}</div> : null}
        {err ? <div className="mt-3 rounded-md border p-3 text-sm">{err}</div> : null}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">Create Invite</div>

        <form action={createInvite} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <Input name="email" placeholder="user@company.com" required />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <select
              name="role"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue="REMOTE_WORKER"
              required
            >
              <option value="MANAGER">MANAGER</option>
              <option value="BUSINESS_DEVELOPER">BUSINESS_DEVELOPER</option>
              <option value="REMOTE_WORKER">REMOTE_WORKER</option>
              <option value="ONSITE_EMPLOYEE">ONSITE_EMPLOYEE</option>
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Worker Type (optional)</label>
            <select
              name="workerType"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="">(none)</option>
              <option value="ONSITE_VIDEO_EDITOR">ONSITE_VIDEO_EDITOR</option>
              <option value="REMOTE_VIDEO_EDITOR">REMOTE_VIDEO_EDITOR</option>
              <option value="ONSITE_ANIMATOR">ONSITE_ANIMATOR</option>
              <option value="REMOTE_ANIMATOR">REMOTE_ANIMATOR</option>
              <option value="WEB_DEVELOPMENT">WEB_DEVELOPMENT</option>
              <option value="OPERATIONS">OPERATIONS</option>
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Departments</label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <input type="checkbox" name="departmentIds" value={d.id} />
                  <span>{d.name}</span>
                </label>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">At least 1 is required.</div>
          </div>

          <div className="md:col-span-2">
            <Button type="submit">Send Invite</Button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">Recent Invites</div>

        <div className="mt-4 space-y-3">
          {invites.length === 0 ? (
            <div className="text-sm text-muted-foreground">No invites yet.</div>
          ) : (
            invites.map((inv) => (
              <div key={inv.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{inv.email}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {inv.role}
                      {inv.workerType ? ` • ${inv.workerType}` : ""} • {inv.status} • expires{" "}
                      {new Date(inv.expiresAt).toLocaleString()}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {inv.departments.map((x) => (
                        <span key={x.department.id} className="rounded-md border px-2 py-0.5 text-xs">
                          {x.department.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <form action={resendInvite}>
                      <input type="hidden" name="id" value={inv.id} />
                      <Button type="submit" variant="secondary" disabled={inv.status !== "PENDING"}>
                        Resend
                      </Button>
                    </form>

                    <form action={revokeInvite}>
                      <input type="hidden" name="id" value={inv.id} />
                      <Button type="submit" variant="destructive" disabled={inv.status !== "PENDING"}>
                        Revoke
                      </Button>
                    </form>
                  </div>
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  Invited by: {inv.createdBy?.fullName ?? inv.createdBy?.username ?? "—"} • created{" "}
                  {new Date(inv.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
