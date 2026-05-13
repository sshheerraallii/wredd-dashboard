import Link from "next/link";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { requireRole } from "@/lib/guards";
import { deleteDepartment, updateDepartment } from "../../actions";

const prisma = getPrisma();

export default async function EditDepartmentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { ok?: string; err?: string };
}) {
  await requireAdmin();

  const department = await prisma.department.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });

  if (!department) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-3">
        <p className="text-sm">Department not found.</p>
        <Link className="underline text-sm" href="/app/admin/departments">
          Back
        </Link>
      </div>
    );
  }

  const ok = searchParams?.ok;
  const err = searchParams?.err;

  async function onUpdate(formData: FormData) {
    "use server";
    await requireRole(["SUPER_ADMIN", "MANAGER"]);
    return updateDepartment(department.id, formData);
  }

  async function onDelete() {
    "use server";
    await requireRole(["SUPER_ADMIN", "MANAGER"]);
    // basic confirm: do it client-side by requiring a checkbox instead (simpler than hooks)
    return deleteDepartment(department.id);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit Department</h1>
        <Link className="underline text-sm" href="/app/admin/departments">
          Back
        </Link>
      </div>

      {ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <form action={onUpdate} className="space-y-3">
        <div>
          <label className="text-sm text-muted-foreground">Name</label>
          <input
            name="name"
            defaultValue={department.name}
            className="mt-1 w-full border rounded-md px-3 py-2 bg-background"
            required
            minLength={2}
            maxLength={60}
          />
        </div>

        <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground">
          Save
        </button>
      </form>

      <form action={onDelete} className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirm" required />
          Confirm delete
        </label>

        <button className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground">
          Delete Department
        </button>
      </form>
    </div>
  );
}
