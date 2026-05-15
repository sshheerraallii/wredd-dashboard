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

function buildNavGroups(args: {
  role?: Role;
  userId: string;
  workerType?: WorkerType;
}): NavGroup[] {
  const { role, userId } = args;
  const groups: NavGroup[] = [];

  // ── SUPER ADMIN ───────────────────────────────────────────────────────────
  if (isSuperAdmin(role)) {
    groups.push(
      {
        key: "work",
        title: "Work",
        defaultOpen: true,
        items: [
          { href: "/app/admin", label: "Dashboard" },
          { href: "/app/projects", label: "Projects" },
          { href: "/app/projects/new", label: "Create Project" },
        ],
      },
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

  // ── MANAGER ───────────────────────────────────────────────────────────────
  if (isManager(role)) {
    groups.push(
      {
        key: "work",
        title: "Work",
        defaultOpen: true,
        items: [
          { href: "/app/projects", label: "Projects" },
          { href: "/app/projects/new", label: "Create Project" },
        ],
      },
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

  // ── BUSINESS DEVELOPER ────────────────────────────────────────────────────
  if (isBD(role)) {
    groups.push(
      {
        key: "work",
        title: "Work",
        defaultOpen: true,
        items: [
          { href: "/app/bd", label: "Dashboard" },
          { href: "/app/projects", label: "All Projects" },
          { href: "/app/projects/new", label: "Create Project" },
        ],
      },
      {
        key: "finance",
        title: "My Finance",
        defaultOpen: true,
        items: [
          { href: "/app/bd/commission", label: "My Commission" },
        ],
      }
    );
  }

  // ── REMOTE WORKER ─────────────────────────────────────────────────────────
  if (role === "REMOTE_WORKER") {
    groups.push(
      {
        key: "work",
        title: "Work",
        defaultOpen: true,
        items: [
          { href: "/app/worker", label: "Projects" },
        ],
      },
      {
        key: "worker",
        title: "My Stats",
        defaultOpen: true,
        items: [
          { href: "/app/worker/performance", label: "Performance" },
          { href: "/app/worker/payments", label: "Payments" },
        ],
      }
    );
  }

  // ── ONSITE EMPLOYEE ───────────────────────────────────────────────────────
  if (role === "ONSITE_EMPLOYEE") {
    groups.push(
      {
        key: "work",
        title: "Work",
        defaultOpen: true,
        items: [
          { href: "/app/worker", label: "Projects" },
        ],
      },
      {
        key: "worker",
        title: "My Stats",
        defaultOpen: true,
        items: [
          { href: "/app/worker/performance", label: "Performance" },
        ],
      }
    );
  }

  // ── ACCOUNT (all roles) ───────────────────────────────────────────────────
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