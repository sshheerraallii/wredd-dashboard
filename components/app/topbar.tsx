import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { TopbarClient } from "./topbar-client";

const prisma = getPrisma();

export async function Topbar({ userId }: { userId: string }) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const [me, unread] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarPath: true, fullName: true, username: true },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  return <TopbarClient me={me} unreadNotifications={unread} />;
}
