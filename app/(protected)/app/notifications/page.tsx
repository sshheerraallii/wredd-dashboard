import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { markAllRead, markOneRead } from "./actions";

const prisma = getPrisma();

export default async function NotificationsPage() {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  const items = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId, readAt: null },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread
          </p>
        </div>

        <form action={markAllRead}>
          <Button type="submit" variant="secondary" disabled={unreadCount === 0}>
            Mark all read
          </Button>
        </form>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No notifications yet.</div>
        ) : (
          items.map((n) => (
            <div key={n.id} className="p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium truncate">{n.title}</div>
                  {n.readAt ? null : (
                    <span className="text-[11px] rounded-full px-2 py-0.5 bg-primary/20">
                      NEW
                    </span>
                  )}
                </div>

                {n.body ? (
                  <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                    {n.body}
                  </div>
                ) : null}

                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
                  {n.href ? (
                    <Link className="underline underline-offset-4" href={n.href}>
                      Open
                    </Link>
                  ) : null}
                </div>
              </div>

              {n.readAt ? null : (
                <form action={markOneRead}>
                  <input type="hidden" name="id" value={n.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    Mark read
                  </Button>
                </form>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
