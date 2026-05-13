// app/(protected)/app/projects/[id]/edit/page.tsx
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import EditProjectForm from "./project-edit-form";

const prisma = getPrisma();

function requireCanManageProject(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "BUSINESS_DEVELOPER") {
    redirect("/app?err=forbidden");
  }
}

export default async function ProjectEditPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const session = await readSession();
  requireCanManageProject(session?.user?.role);

  const [project, departments] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        departmentId: true,
        deadlineHours: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.department.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!project) redirect("/app/projects?err=not_found");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Edit Project</div>
          <div className="text-sm text-muted-foreground">Update core project details.</div>
        </div>
      </div>

      <EditProjectForm project={project} departments={departments} />
    </div>
  );
}