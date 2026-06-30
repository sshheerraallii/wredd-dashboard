// /app/app/admin/departments/page.tsx
import Link from "next/link";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { createDepartment } from "./actions";

const prisma = getPrisma();

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams?: { ok?: string; err?: string };
}) {
  await requireAdmin();

  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const ok = searchParams?.ok;
  const err = searchParams?.err;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Departments</h1>
      </div>

      {ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <form action={createDepartment} className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground">New Department</label>
          <input
            name="name"
            placeholder="e.g., Operations"
            className="mt-1 w-full border rounded-md px-3 py-2 bg-background"
            required
            minLength={2}
            maxLength={60}
          />
        </div>
        <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground">
          Add
        </button>
      </form>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2 text-sm bg-muted/40">
          <div className="col-span-10 font-medium">Name</div>
          <div className="col-span-2 font-medium text-right">Action</div>
        </div>

        {departments.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No departments yet.</div>
        ) : (
          <div className="divide-y">
            {departments.map((d) => (
              <div key={d.id} className="grid grid-cols-12 px-4 py-3 text-sm">
                <div className="col-span-10">{d.name}</div>
                <div className="col-span-2 text-right">
                  <Link href={`/app/admin/departments/${d.id}/edit`} className="underline">
                    Edit
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
