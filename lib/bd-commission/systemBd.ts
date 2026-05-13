// lib/bd-commission/systemBd.ts
import type { PrismaClient, User } from "@prisma/client";
import { SYSTEM_BD_EMAIL, SYSTEM_BD_KEY } from "./constants";

export function isSystemBd(
  user?: Pick<User, "username" | "email" | "archivedAt"> | null
): boolean {
  if (!user) return false;
  if (user.archivedAt) return false;
  return user.username === SYSTEM_BD_KEY || user.email === SYSTEM_BD_EMAIL;
}

/**
 * Ensures the System BD user exists and is active (archivedAt = null).
 * This is an INTERNAL account used for default bdOwnerId when admin creates a project
 * without selecting a BD.
 *
 * Why not invite-flow?
 * - Your schema requires User.passwordHash (non-null).
 * - Invites only create a User AFTER acceptance; we need a real User.id immediately.
 */
export async function upsertSystemBd(
  prisma: PrismaClient,
  args: { fullName: string; passwordHash: string }
): Promise<User> {
  const { fullName, passwordHash } = args;

  return prisma.user.upsert({
    where: { username: SYSTEM_BD_KEY },
    create: {
      fullName,
      username: SYSTEM_BD_KEY,
      email: SYSTEM_BD_EMAIL,
      passwordHash,
      role: "BUSINESS_DEVELOPER",
      workerType: null,
      archivedAt: null,
    },
    update: {
      fullName,
      email: SYSTEM_BD_EMAIL,
      role: "BUSINESS_DEVELOPER",
      workerType: null,
      archivedAt: null,
      // keep passwordHash updated so it stays non-loginable & deterministic from seed
      passwordHash,
    },
  });
}