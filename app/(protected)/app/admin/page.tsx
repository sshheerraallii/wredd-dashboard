export const dynamic = "force-dynamic";
export const revalidate = 0;

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

export default async function AdminIndex() {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");

  // Manager/Super Admin should land on the real working screen:
  redirect("/app/projects");
}
