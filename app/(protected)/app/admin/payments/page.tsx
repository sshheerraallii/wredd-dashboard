// app/(protected)/app/admin/payments/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markPaymentLineExceptionPaid, markPaymentLinePaid } from "./actions";
import { bucketPaymentLine, type Bucket } from "@/lib/payments-bucket";
import { PendingForm, PendingSubmitButton } from "@/components/forms/pending-form";

const prisma = getPrisma();

function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");
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

const HISTORY_PAGE_SIZE = 50;

function parsePositiveInt(input: string | undefined, fallback: number) {
  const n = Number((input ?? "").trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function TabsRow({ tab, page }: { tab: Tab; page: number }) {
  const items: { key: Tab; label: string }[] = [
    { key: "due", label: "Due" },
    { key: "clearing", label: "Clearing" },
    { key: "active", label: "Active" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const isActive = tab === it.key;
          const href =
            it.key === "history"
              ? `/app/admin/payments?tab=history&page=${page}`
              : `/app/admin/payments?tab=${it.key}`;

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

      <Button asChild variant="outline">
        <Link href="/app/admin/payments/worker">Worker specific payments</Link>
      </Button>
    </div>
  );
}

type LineRow = {
  line: {
    id: string;
    amount: any;
    status: string;
    payableOn: Date;
    paidAt: Date | null;
    note: string | null;

    user?: { id: string; fullName: string | null; username: string | null; role: string | null };

    project: {
      id: string;
      title: string | null;
      status: string | null;
      firstCompletedAt: Date | null;
    } | null;

    paidBy: { id?: string; fullName: string | null; username: string | null } | null;
  };
  bucket: Bucket;
};

function Table({
  tab,
  title,
  items,
}: {
  tab: Tab;
  title: string;
  items: LineRow[];
}) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="text-sm font-medium">
          {title}{" "}
          <span className="text-xs text-muted-foreground">({items.length})</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-3 px-4 text-left font-medium">Project / Reason</th>
              <th className="py-3 px-4 text-left font-medium">Worker</th>
              <th className="py-3 px-4 text-left font-medium">Amount</th>
              <th className="py-3 px-4 text-left font-medium">Payable On</th>
              <th className="py-3 px-4 text-left font-medium">Status</th>
              <th className="py-3 px-4 text-right font-medium">Actions</th>
            </tr>
          </thead>

          <tbody>
            {items.map(({ line }) => {
              const canMark = tab !== "history" && line.status === "UNPAID";

              return (
                <tr key={line.id} className="border-b last:border-0 align-top">
                  <td className="py-3 px-4">
                    {line.project?.id ? (
                      <>
                        <div className="font-medium">
                          <Link className="hover:underline" href={`/app/projects/${line.project.id}`}>
                            {line.project.title ?? "Untitled project"}
                          </Link>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Project: {line.project.status ?? "—"} • First completed:{" "}
                          {fmtDate(line.project.firstCompletedAt)}
                        </div>
                        {line.note ? (
                          <div className="mt-1 text-xs text-muted-foreground">Note: {line.note}</div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="font-medium">Manual entry</div>
                        <div className="text-xs text-muted-foreground">
                          {line.note ? `Reason: ${line.note}` : "—"}
                        </div>
                      </>
                    )}
                  </td>

                  <td className="py-3 px-4">
                    {line.user ? (
                      <>
                        <div className="font-medium">
                          {line.user.fullName ?? "—"}{" "}
                          <span className="text-muted-foreground">({line.user.username ?? "—"})</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{line.user.role ?? "—"}</div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
                  </td>

                  <td className="py-3 px-4 text-right">
                    {canMark ? (
                      <div className="flex flex-col items-end gap-2">
                        <PendingForm action={markPaymentLinePaid} className="flex items-center gap-2">
                          {(pending) => (
                            <>
                              <input type="hidden" name="lineId" value={line.id} />
                              <Input name="note" placeholder="Note (optional)" className="h-9 w-48" disabled={pending} />
                              <PendingSubmitButton pending={pending} pendingLabel="Marking…" className="h-9">
                                Mark PAID
                              </PendingSubmitButton>
                            </>
                          )}
                        </PendingForm>

                        <PendingForm
                          action={markPaymentLineExceptionPaid}
                          className="flex items-center gap-2"
                        >
                          {(pending) => (
                            <>
                              <input type="hidden" name="lineId" value={line.id} />
                              <Input
                                name="note"
                                placeholder="Exception note (optional)"
                                className="h-9 w-48"
                                disabled={pending}
                              />
                              <PendingSubmitButton
                                pending={pending}
                                pendingLabel="Marking…"
                                variant="secondary"
                                className="h-9"
                              >
                                Exception Paid
                              </PendingSubmitButton>
                            </>
                          )}
                        </PendingForm>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {!items.length ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  No items.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AdminPaymentsSummaryPage({
  searchParams,
}: {
  searchParams?: { tab?: string; page?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");
  requireManagerOrAdmin((session.user as any)?.role);

  const now = new Date();
  const tab = parseTab(searchParams?.tab);

  const page = tab === "history" ? parsePositiveInt(searchParams?.page, 1) : 1;
  const historySkip = (page - 1) * HISTORY_PAGE_SIZE;

  let lines: any[] = [];
  let totalHistory = 0;

  if (tab === "history") {
    const whereHistory = {
      status: { in: ["PAID", "EXCEPTION_PAID"] as any },
      NOT: { status: "VOIDED" as any },
    };

    totalHistory = await prisma.projectPaymentLine.count({ where: whereHistory as any });

    lines = await prisma.projectPaymentLine.findMany({
      where: whereHistory as any,
      select: {
        id: true,
        amount: true,
        status: true,
        payableOn: true,
        paidAt: true,
        note: true,
        user: { select: { id: true, fullName: true, username: true, role: true } },
        project: { select: { id: true, title: true, status: true, firstCompletedAt: true } },
        paidBy: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      skip: historySkip,
      take: HISTORY_PAGE_SIZE,
    });
  } else {
    // For due/clearing/active, only fetch unpaid + non-voided.
    lines = await prisma.projectPaymentLine.findMany({
      where: {
        status: "UNPAID",
        NOT: { status: "VOIDED" as any },
      } as any,
      select: {
        id: true,
        amount: true,
        status: true,
        payableOn: true,
        paidAt: true,
        note: true,
        user: { select: { id: true, fullName: true, username: true, role: true } },
        project: { select: { id: true, title: true, status: true, firstCompletedAt: true } },
        paidBy: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: [{ payableOn: "asc" }, { createdAt: "desc" }],
      take: 2000,
    });
  }

  const rows: LineRow[] = lines
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

      return b === "HIDE" ? null : ({ line: l, bucket: b } as LineRow);
    })
    .filter(Boolean) as LineRow[];

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

  const totalPages = tab === "history" ? Math.max(1, Math.ceil(totalHistory / HISTORY_PAGE_SIZE)) : 1;
  const historyBase = "/app/admin/payments?tab=history";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payments Summary</h1>
          <p className="text-sm text-muted-foreground">
            Clearing → Due happens on the <span className="font-medium">1st of the payable month</span>. “Payable On” remains the actual pay date.
          </p>
        </div>
      </div>

      <TabsRow tab={tab} page={page} />

      <Table tab={tab} title={currentTitle} items={currentItems} />

      {tab === "history" ? (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages} • Total: {totalHistory}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link href={`${historyBase}&page=${Math.max(1, page - 1)}`}>Prev</Link>
            </Button>

            <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
              <Link href={`${historyBase}&page=${Math.min(totalPages, page + 1)}`}>Next</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
