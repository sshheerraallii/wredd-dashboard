// app/(protected)/app/worker/payments/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { bucketPaymentLine, type Bucket } from "@/lib/payments-bucket";

const prisma = getPrisma();

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD"
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

function requireWorker(role?: Role) {
  if (role !== "REMOTE_WORKER") redirect("/app?err=forbidden");
}

function fmtMoney(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    if (Number.isFinite(n)) return n.toFixed(2);
  } catch {}
  return String(v ?? "");
}

function fmtDate(d?: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

const TABS = ["due", "clearing", "active", "history"] as const;
type Tab = (typeof TABS)[number];

function parseTab(input: string | undefined): Tab {
  const t = (input ?? "").toLowerCase();
  return (TABS as readonly string[]).includes(t) ? (t as Tab) : "due";
}

function TabsRow({ tab }: { tab: Tab }) {
  const items: { key: Tab; label: string }[] = [
    { key: "due", label: "Due" },
    { key: "clearing", label: "Clearing" },
    { key: "active", label: "Active" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const isActive = tab === it.key;
        const href = `/app/worker/payments?tab=${it.key}`;
        return (
          <Link
            key={it.key}
            href={href}
            className={[
              "rounded-full border px-3 py-1 text-sm transition-colors",
              isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            ].join(" ")}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

type Row = {
  line: {
    id: string;
    amount: any;
    status: string;
    payableOn: Date;
    paidAt: Date | null;
    note: string | null;
    project: { id: string; title: string | null; status: string | null; firstCompletedAt: Date | null } | null;
    paidBy: { fullName: string | null; username: string | null } | null;
  };
  bucket: Bucket;
};

export default async function WorkerPaymentsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  requireWorker(role);

  const userId = session.user.id as string;
  const now = new Date();
  const tab = parseTab(searchParams?.tab);

  const where =
    tab === "history"
      ? ({
          userId,
          status: { in: ["PAID", "EXCEPTION_PAID"] as any },
          NOT: { status: "VOIDED" as any },
        } as any)
      : ({
          userId,
          status: "UNPAID",
          NOT: { status: "VOIDED" as any },
        } as any);

  const lines = await prisma.projectPaymentLine.findMany({
    where,
    select: {
      id: true,
      amount: true,
      status: true,
      payableOn: true,
      paidAt: true,
      note: true,
      project: { select: { id: true, title: true, status: true, firstCompletedAt: true } },
      paidBy: { select: { fullName: true, username: true } },
    },
    orderBy:
      tab === "history"
        ? [{ paidAt: "desc" }, { createdAt: "desc" }]
        : [{ payableOn: "asc" }, { createdAt: "desc" }],
    take: tab === "history" ? 300 : 1000,
  });

  const rows: Row[] = lines
    .map((l) => {
      const b =
        tab === "history"
          ? ("HISTORY" as const)
          : bucketPaymentLine({
              projectStatus: l.project?.status ?? null,
              lineStatus: l.status,
              payableOn: l.payableOn,
              now,
            });

      return b === "HIDE" ? null : ({ line: l, bucket: b } as Row);
    })
    .filter(Boolean) as Row[];

  const active = rows.filter((r) => r.bucket === "ACTIVE");
  const clearing = rows.filter((r) => r.bucket === "CLEARING");
  const due = rows.filter((r) => r.bucket === "DUE");
  const history = rows.filter((r) => r.bucket === "HISTORY");

  const currentItems =
    tab === "due" ? due : tab === "clearing" ? clearing : tab === "active" ? active : history;

  const currentTitle =
    tab === "due"
      ? "Due (Moves on 1st of payable month)"
      : tab === "clearing"
      ? "Clearing (Before 1st of payable month)"
      : tab === "active"
      ? "Active / Ongoing"
      : "History (Paid / Exception)";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Payments</h1>
        <p className="text-sm text-muted-foreground">
          Clearing → Due happens on the <span className="font-medium">1st of the payable month</span>. “Payable On” remains the actual pay date.
        </p>
      </div>

      <TabsRow tab={tab} />

      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="text-sm font-medium">
            {currentTitle}{" "}
            <span className="text-xs text-muted-foreground">({currentItems.length})</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 px-4 text-left font-medium">Project / Reason</th>
                <th className="py-3 px-4 text-left font-medium">Amount</th>
                <th className="py-3 px-4 text-left font-medium">Payable On</th>
                <th className="py-3 px-4 text-left font-medium">Status</th>
              </tr>
            </thead>

            <tbody>
              {currentItems.map(({ line }) => (
                <tr key={line.id} className="border-b last:border-0 align-top">
                  <td className="py-3 px-4">
                    <div className="font-medium">
                      {line.project?.id ? (
                        <Link className="hover:underline" href={`/app/projects/${line.project.id}`}>
                          {line.project.title ?? "Untitled project"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Manual entry</span>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground">
                      {line.project ? (
                        <>
                          Project: {line.project.status ?? "—"} • First completed:{" "}
                          {fmtDate(line.project.firstCompletedAt)}
                        </>
                      ) : (
                        <>Manual entry{line.note ? ` • Reason: ${line.note}` : ""}</>
                      )}
                    </div>
                  </td>

                  <td className="py-3 px-4 font-medium">{fmtMoney(line.amount)}</td>

                  <td className="py-3 px-4">{fmtDate(line.payableOn)}</td>

                  <td className="py-3 px-4">
                    <div className="font-medium">{line.status}</div>

                    {line.paidAt ? (
                      <div className="text-xs text-muted-foreground">
                        Paid at: {fmtDate(line.paidAt)}
                        {line.paidBy ? (
                          <>
                            {" "}
                            • by {line.paidBy.fullName ?? "—"} ({line.paidBy.username ?? "—"})
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {line.note ? (
                      <div className="mt-1 text-xs text-muted-foreground">Note: {line.note}</div>
                    ) : null}
                  </td>
                </tr>
              ))}

              {!currentItems.length ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">
                    No items.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
