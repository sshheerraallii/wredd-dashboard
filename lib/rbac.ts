// /lib/rbac.ts
import { Role } from "@prisma/client";
import { readSession } from "@/lib/auth";

export async function requireAuth() {
  const session = await readSession();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function requireRole(allowed: Role[]) {
  const session = await requireAuth();
  const role = session.user.role;

  if (!allowed.includes(role)) throw new Error("FORBIDDEN");
  return session;
}

export async function requireAdmin() {
  return requireRole([Role.SUPER_ADMIN, Role.MANAGER]);
}
