"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/app/logout-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Bell } from "lucide-react";
import { LiveNotifications } from "@/components/app/live-notifications";

function titleForPath(path: string) {
  if (path.startsWith("/app/notifications")) return "Notifications";
  if (path.startsWith("/app/projects")) return "Projects";
  if (path.startsWith("/app/bd")) return "BD Dashboard";
  if (path.startsWith("/app/worker")) return "Worker Dashboard";
  if (path.startsWith("/app/payments")) return "Payments";
  if (path.startsWith("/app/points")) return "Points";
  if (path.startsWith("/app/admin/users")) return "Users";
  if (path.startsWith("/app/admin/departments")) return "Departments";
  if (path.startsWith("/app/admin")) return "Admin";
  if (path.startsWith("/app/users/")) return "Profile";
  if (path === "/app") return "Dashboard";
  return "Wredd";
}

type Me = {
  id: string;
  avatarPath: string | null;
  fullName: string | null;
  username: string | null;
};

export function TopbarClient({
  me,
  unreadNotifications,
}: {
  me: Me | null;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const title = titleForPath(pathname);

  const displayName = (me?.fullName || me?.username || "Profile").trim();
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="border-b bg-background">
      <div className="h-14 px-6 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{title}</div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* 🔔 Notifications */}
          <Button asChild variant="outline" size="sm">
            <Link href="/app/notifications" className="relative">
              <Bell className="h-4 w-4" />
              {unreadNotifications > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-[16px] text-center">
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              ) : null}
            </Link>
          </Button>

          {/* Profile */}
          {me ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/users/${me.id}`} className="flex items-center gap-2">
                <span className="relative h-6 w-6 overflow-hidden rounded-full border bg-muted">
                  {me.avatarPath ? (
                    <Image
                      src={me.avatarPath}
                      alt="Avatar"
                      fill
                      sizes="24px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="h-full w-full grid place-items-center text-[11px] font-semibold text-muted-foreground">
                      {initial}
                    </span>
                  )}
                </span>

                {/* was: "My Profile" */}
                <span className="max-w-[160px] truncate">{displayName}</span>
              </Link>
            </Button>
          ) : null}

          <LogoutButton />
        </div>
      </div>

      {/* 🔔 live toasts + sound */}
      <LiveNotifications />
    </div>
  );
}
