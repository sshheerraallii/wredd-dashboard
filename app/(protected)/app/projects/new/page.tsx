import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import NewProjectForm from "./new-project-form";

const prisma = getPrisma();

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

export default async function NewProjectPage() {
  const session = await readSession();

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role;

  if (!ALLOWED_ROLES.has(role)) {
    redirect("/app");
  }

  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Create Project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a project with billing details. Assignment and delivery are handled later.
        </p>
      </div>

      <NewProjectForm departments={departments} />
    </div>
  );
}