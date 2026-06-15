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
        isSample: true,
        firstCompletedAt: true,
        finance: {
          select: {
            priceUsd: true,
            platformFeePercent: true,
            portal: true,
            clientName: true,
            clientUsername: true,
          },
        },
      },
    }),
    prisma.department.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!project) redirect("/app/projects?err=not_found");

  // Finance is editable only while the project has never been completed.
  const financeEditable = project.firstCompletedAt == null;

  // Serialize Decimals to strings before handing them to the client component.
  const finance = {
    priceUsd: project.finance?.priceUsd != null ? String(project.finance.priceUsd) : "",
    platformFeePercent:
      project.finance?.platformFeePercent != null ? String(project.finance.platformFeePercent) : "",
    portal: project.finance?.portal ?? "OTHER",
    clientName: project.finance?.clientName ?? "",
    clientUsername: project.finance?.clientUsername ?? "",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Edit Project</div>
          <div className="text-sm text-muted-foreground">Update core project details.</div>
        </div>
      </div>

      <EditProjectForm
        project={{
          id: project.id,
          title: project.title,
          description: project.description,
          departmentId: project.departmentId,
          deadlineHours: project.deadlineHours,
        }}
        departments={departments}
        finance={finance}
        isSample={project.isSample}
        financeEditable={financeEditable}
      />
    </div>
  );
}
