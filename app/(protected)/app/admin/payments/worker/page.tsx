// app/(protected)/app/admin/payments/worker/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  markPaymentLineExceptionPaid,
  markPaymentLinePaid,
  markAllWorkerUnpaidPaid,
  createManualPaymentEntry,
} from "../actions";

import { WorkerPickerDialog } from "../_components/worker-picker-dialog";
import { ManualAdjustmentDialog } from "../_components/manual-adjustment-dialog";

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

function WorkerTabsRow({ workerId, tab }: { workerId: string; tab: Tab }) {
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
        const href = `/app/admin/payments/worker?workerId=${encodeURIComponent(workerId)}&tab=${it.key}`;

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

type LineRow = {
  line: {
    id: string;
    amount: any;
    status: string;
    payableOn: Date;
    paidAt: Date | null;
    note: string | null;

    user: { id: string; fullName: string | null; username: string | null; role: string | null };

    project: {
      id: string;
      title: string | null;
      status: string | null;
      firstCompletedAt: Date | null;
    } | null;

    paidBy: { id: string; fullName: string | null; username: string | null } | null;
  };
  bucket: Bucket;
};

export default async function WorkerPaymentsAdminPage({
  searchParams,
}: {
  searchParams?: { workerId?: string; tab?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");
  requireManagerOrAdmin((session.user as any)?.role);

  const now = new Date();
  const workerId = (searchParams?.workerId ?? "").trim() || undefined;
  const tab = parseTab(searchParams?.tab);

  const workers = await prisma.user.findMany({
    where: { archivedAt: null, role: "REMOTE_WORKER" },
    select: { id: true, fullName: true, username: true },
    orderBy: [{ fullName: "asc" }, { username: "asc" }],
    take: 500,
  });

  const selectedWorker = workerId ? workers.find((w) => w.id === workerId) : undefined;

  const projectOptions = await prisma.project.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // No worker selected -> just picker screen
  if (!workerId) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Worker Specific Payments</h1>
            <p className="text-sm text-muted-foreground">
              Select a worker, then manage their Due / Clearing / Active / History.
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href="/app/admin/payments">Back to summary</Link>
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="text-sm font-medium">Select worker</div>
          <WorkerPickerDialog workers={workers} selectedWorkerId={undefined} baseHref="/app/admin/payments/worker" />
          <div className="text-xs text-muted-foreground">No worker selected.</div>
        </div>
      </div>
    );
  }

  // Fetch lines based on tab (avoid loading everything)
  const where =
    tab === "history"
      ? ({
          userId: workerId,
          status: { in: ["PAID", "EXCEPTION_PAID"] as any },
          NOT: { status: "VOIDED" as any },
        } as any)
      : ({
          userId: workerId,
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

      user: { select: { id: true, fullName: true, username: true, role: true } },

      project: { select: { id: true, title: true, status: true, firstCompletedAt: true } },

      paidBy: { select: { id: true, fullName: true, username: true } },
    },
    orderBy:
      tab === "history"
        ? [{ paidAt: "desc" }, { createdAt: "desc" }]
        : [{ payableOn: "asc" }, { createdAt: "desc" }],
    take: tab === "history" ? 500 : 2000,
  });

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

  const due = rows.filter((r) => r.bucket === "DUE");
  const clearing = rows.filter((r) => r.bucket === "CLEARING");
  const active = rows.filter((r) => r.bucket === "ACTIVE");
  const history = rows.filter((r) => r.bucket === "HISTORY");

  const currentItems =
    tab === "due" ? due : tab === "clearing" ? clearing : tab === "active" ? active : history;

  // Bulk summary (unpaid only makes sense when not in history)
  const unpaidAll = tab === "history" ? [] : rows.map((r) => r.line).filter((l) => l.status === "UNPAID");
  const unpaidTotal =
    tab === "history"
      ? 0
      : unpaidAll.reduce((s, l) => s + Number(l.amount?.toString?.() ?? l.amount ?? 0), 0);

  function Table({ items }: { items: LineRow[] }) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 px-4 text-left font-medium">Project / Reason</th>
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

                          <PendingForm action={markPaymentLineExceptionPaid} className="flex items-center gap-2">
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
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
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

  const title =
    tab === "due"
      ? "Due (Moves on 1st of payable month)"
      : tab === "clearing"
      ? "Clearing (Before 1st of payable month)"
      : tab === "active"
      ? "Active"
      : "History";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Worker Specific Payments</h1>
          <p className="text-sm text-muted-foreground">
            Worker: {selectedWorker?.fullName ?? "—"} ({selectedWorker?.username ?? "—"})
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href="/app/admin/payments">Back to summary</Link>
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Worker</div>
            <div className="flex flex-wrap items-center gap-2">
              <WorkerPickerDialog workers={workers} selectedWorkerId={workerId} baseHref="/app/admin/payments/worker" />
              <div className="text-xs text-muted-foreground">Switch worker anytime.</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link
                href={`/app/admin/payments/worker/print?workerId=${encodeURIComponent(workerId)}`}
                target="_blank"
              >
                Export PDF
              </Link>
            </Button>

            <ManualAdjustmentDialog workerId={workerId} projects={projectOptions} action={createManualPaymentEntry} />

            <PendingForm action={markAllWorkerUnpaidPaid} className="flex items-center gap-2">
              {(pending) => (
                <>
                  <input type="hidden" name="workerId" value={workerId} />
                  <Input name="note" placeholder="Bulk note (optional)" className="h-10 w-56" disabled={pending} />
                  <PendingSubmitButton
                    pending={pending}
                    pendingLabel="Marking…"
                    disabled={tab === "history" || unpaidAll.length === 0}
                  >
                    Mark all unpaid as PAID
                  </PendingSubmitButton>
                </>
              )}
            </PendingForm>
          </div>
        </div>

        {tab === "history" ? null : (
          <div className="text-sm">
            <span className="text-muted-foreground">All unpaid items:</span>{" "}
            <span className="font-medium">{unpaidAll.length}</span>
            <span className="mx-2 text-muted-foreground">•</span>
            <span className="text-muted-foreground">All unpaid total:</span>{" "}
            <span className="font-medium">{fmtMoney(unpaidTotal)}</span>
          </div>
        )}

        <WorkerTabsRow workerId={workerId} tab={tab} />
      </div>

      <div className="text-sm font-medium">
        {title} <span className="text-xs text-muted-foreground">({currentItems.length})</span>
      </div>

      <Table items={currentItems} />
    </div>
  );
}
