import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";

export type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function backForbidden(msg: string = "forbidden") {
  redirect(`/app?err=${encodeURIComponent(msg)}`);
}

function backUnauthorized() {
  redirect("/login");
}

function backArchived() {
  redirect("/archived");
}

export function isSuperAdmin(role?: Role | null) {
  return role === "SUPER_ADMIN";
}

/**
 * Base: must be logged in + not archived.
 * SUPER_ADMIN is NOT exempt from archive block (recommended).
 * If you want SUPER_ADMIN to bypass archive too, tell me and I’ll flip it.
 */
export async function requireUser() {
  const session = await readSession();
  if (!session?.user) backUnauthorized();

  if ((session.user as any).archivedAt) backArchived();

  return session.user as any;
}

/**
 * ✅ Role gate
 * - SUPER_ADMIN passes any allowed[] automatically
 */
export async function requireRole(allowed: Role[]) {
  const user = await requireUser();
  const role = user.role as Role | undefined;

  if (isSuperAdmin(role)) return user;

  if (!role || !allowed.includes(role)) backForbidden();
  return user;
}

/**
 * ✅ Conditional guard for business rules
 * Use this instead of `if (!cond) redirect(...)`
 * - SUPER_ADMIN bypasses automatically
 */
export function requireCondition(
  role: Role | undefined,
  condition: any,
  errMsg: string = "forbidden"
) {
  if (isSuperAdmin(role)) return;
  if (!condition) backForbidden(errMsg);
}

/**
 * Optional convenience helpers (also super-admin aware)
 */
export function isWorker(role?: Role) {
  return isSuperAdmin(role) || role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}

export function isAdminish(role?: Role) {
  return (
    isSuperAdmin(role) ||
    role === "MANAGER" ||
    role === "BUSINESS_DEVELOPER" ||
    role === "BD"
  );
}
