import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import CreateUserForm from "./_components/create-user-form";

const prisma = getPrisma();

export default async function NewUserPage() {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");

  const departments = await prisma.department.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Create user</h1>
        <p className="text-sm text-muted-foreground">
          Create a new user and assign departments.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <CreateUserForm departments={departments} />
      </div>
    </div>
  );
}
