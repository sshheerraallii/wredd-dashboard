import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

type WorkerType =
  | "ONSITE_VIDEO_EDITOR"
  | "REMOTE_VIDEO_EDITOR"
  | "ONSITE_ANIMATOR"
  | "REMOTE_ANIMATOR"
  | "WEB_DEVELOPMENT"
  | "OPERATIONS";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const userId = session.user.id;
  const workerType = (session.user as any).workerType as WorkerType | undefined;

  return (
    <div className="min-h-screen">
      <div className="flex">
        <aside className="hidden md:block w-72 border-r bg-background">
          <Sidebar role={role} userId={userId} workerType={workerType} />
        </aside>

        <main className="flex-1">
          <Topbar userId={userId} />
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
