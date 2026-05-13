import Link from "next/link";
import Image from "next/image";
import { Separator } from "@/components/ui/separator";

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

type NavItem = { href: string; label: string };
type NavGroup = {
  key: string;
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

function isSuperAdmin(role?: Role) {
  return role === "SUPER_ADMIN";
}
function isManager(role?: Role) {
  return role === "MANAGER";
}
function isBD(role?: Role) {
  return role === "BUSINESS_DEVELOPER" || role === "BD";
}
function isWorker(role?: Role) {
  return role === "REMOTE_WORKER" || role === "ONSITE_EMPLOYEE";
}
function isRemoteWorker(workerType?: WorkerType) {
  return workerType === "REMOTE_VIDEO_EDITOR" || workerType === "REMOTE_ANIMATOR";
}

function buildNavGroups(args: {
  role?: Role;
  userId: string;
  workerType?: WorkerType;
}): NavGroup[] {
  const { role, userId, workerType } = args;
  const groups: NavGroup[] = [];

  // ================= WORK =================
  const work: NavItem[] = [];

  if (isSuperAdmin(role)) {
    work.push({ href: "/app/admin", label: "Dashboard" });
    work.push({ href: "/app/projects", label: "Projects" });
  } else if (isBD(role)) {
    work.push({ href: "/app/bd", label: "Dashboard" });
    work.push({ href: "/app/projects", label: "All Projects" });
    work.push({ href: "/app/projects/new", label: "Create Project" });
    work.push({ href: "/app/bd/commission", label: "My Commission" }); // ✅ Added
  } else if (isWorker(role)) {
    work.push({ href: "/app/worker", label: "Projects" });
  } else {
    work.push({ href: "/app", label: "Dashboard" });
    work.push({ href: "/app/projects", label: "Projects" });
  }

  groups.push({ key: "work", title: "Work", items: work, defaultOpen: true });

  // ================= SUPER ADMIN =================
  if (isSuperAdmin(role)) {
    groups.push(
      {
        key: "team",
        title: "Team Management",
        defaultOpen: true,
        items: [
          { href: "/app/admin/users", label: "Users" },
          { href: "/app/admin/departments", label: "Departments" },
          { href: "/app/admin/invites", label: "Invites" },
          { href: "/app/admin/announcements", label: "Announcements" },
        ],
      },
      {
        key: "finance",
        title: "Finance & Commission",
        defaultOpen: true,
        items: [
          { href: "/app/admin/finance-config", label: "Finance Config" },
          { href: "/app/admin/bd-config", label: "BD Configs" },
          { href: "/app/admin/bd-commission", label: "BD Commission Ledger" },
        ],
      },
      {
        key: "operations",
        title: "Operations & Reports",
        defaultOpen: true,
        items: [
          { href: "/app/admin/payments", label: "Payments Summary" },
          { href: "/app/admin/payments/worker", label: "Worker Payments" },
          { href: "/app/performance", label: "Performance" },
        ],
      }
    );
  }

  // ================= MANAGER =================
  if (isManager(role)) {
    groups.push({
      key: "manager",
      title: "Operations",
      defaultOpen: true,
      items: [
        { href: "/app/projects", label: "Projects" },
        { href: "/app/performance", label: "Performance" },
        { href: "/app/admin/payments", label: "Payments Summary" },
      ],
    });
  }

  // ================= WORKER =================
  if (isWorker(role)) {
    const workerItems: NavItem[] = [
      { href: "/app/worker/performance", label: "Performance" },
    ];

    if (isRemoteWorker(workerType)) {
      workerItems.push({ href: "/app/worker/payments", label: "Payments" });
    }

    groups.push({
      key: "worker",
      title: "My Performance",
      defaultOpen: true,
      items: workerItems,
    });
  }

  // ================= ACCOUNT =================
  groups.push({
    key: "account",
    title: "Account",
    defaultOpen: true,
    items: [
      { href: "/app/notifications", label: "Notifications" },
      { href: `/app/users/${userId}`, label: "Profile" },
    ],
  });

  return groups.filter((g) => g.items.length > 0);
}

export function Sidebar({
  role,
  userId,
  workerType,
}: {
  role?: Role;
  userId: string;
  workerType?: WorkerType;
}) {
  const groups = buildNavGroups({ role, userId, workerType });

  return (
    <aside className="h-screen sticky top-0 flex flex-col bg-background border-r">
      <div className="p-4">
        <Link href="/app" className="flex items-center gap-3">
          <div className="relative h-10 w-10 overflow-hidden rounded-xl border bg-muted">
            <Image
              src="/brand/wredd-logo.png"
              alt="WREDD"
              fill
              sizes="40px"
              className="object-cover"
              unoptimized
            />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Wredd</div>
            <div className="text-xs text-muted-foreground">
              Internal Dashboard
            </div>
          </div>
        </Link>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {groups.map((group) => (
          <details
            key={group.key}
            open={group.defaultOpen}
            className="group"
          >
            <summary className="cursor-pointer px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
              {group.title}
            </summary>

            <div className="mt-1 space-y-1">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-xl px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        ))}
      </nav>

      <Separator />

      <div className="p-4 space-y-3">
        <a
          href="https://wredd.com"
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
        >
          WREDD public Website
        </a>
        <div className="text-xs text-muted-foreground">
          WREDD • Internal v1
        </div>
      </div>
    </aside>
  );
}