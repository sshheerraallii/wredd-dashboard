// app/(protected)/app/admin/client-payments/[id]/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";
import { getProjectForPaymentDetail } from "@/lib/client-payments/queries";
import { addClientPaymentReceipt, updateReceiptFundStatus, deleteClientPaymentReceipt } from "../actions";
import { AddReceiptDialog } from "../_components/add-receipt-dialog";
import { FundStatusForm } from "../_components/fund-status-form";

const prisma = getPrisma();

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(d: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusLabel(s: string) {
  if (s === "FULLY_RECEIVED") return "Fully Received";
  if (s === "PARTIALLY_RECEIVED") return "Partially Received";
  return "Not Received";
}

function statusClass(s: string) {
  if (s === "FULLY_RECEIVED") return "bg-green-100 text-green-800 border-green-200";
  if (s === "PARTIALLY_RECEIVED") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function fundLabel(s: string) {
  if (s === "UTILIZED") return "Utilized";
  if (s === "SETTLED_TO_WREDD_FBL") return "Settled to WREDD FBL";
  return "In Hand";
}

export default async function ClientPaymentDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { ok?: string; err?: string };
}) {
  await requireRole(["SUPER_ADMIN"]);

  const [project, accounts] = await Promise.all([
    getProjectForPaymentDetail(params.id),
    prisma.paymentAccount.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!project) notFound();

  const ok = searchParams?.ok;
  const err = searchParams?.err;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/app/admin/client-payments" className="text-sm underline text-muted-foreground">
          ← Back to Client Payments
        </Link>
      </div>

      {ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{project.title}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            {project.department?.name ?? "-"} · {project.bdOwner?.fullName ?? "No BD"} · Completed{" "}
            {fmtDate(project.firstCompletedAt)}
          </div>
          {project.finance?.clientName ? (
            <div className="text-sm text-muted-foreground">Client: {project.finance.clientName}</div>
          ) : null}
        </div>

        <AddReceiptDialog projectId={project.id} accounts={accounts} action={addClientPaymentReceipt} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Price</div>
          <div className="text-lg font-semibold">{fmtUsd(project.priceUsd)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Portal Fee</div>
          <div className="text-lg font-semibold">{fmtUsd(project.feeUsd)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Net Expected</div>
          <div className="text-lg font-semibold">{fmtUsd(project.netExpectedUsd)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Total Received</div>
          <div className="text-lg font-semibold">{fmtUsd(project.totalReceived)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Status</div>
          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full border text-xs ${statusClass(project.paymentStatus)}`}>
            {statusLabel(project.paymentStatus)}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Payment Receipts</h2>

        {project.clientPaymentReceipts.length === 0 ? (
          <div className="border rounded-lg px-4 py-8 text-sm text-muted-foreground text-center">
            No payments recorded yet for this project.
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {project.clientPaymentReceipts.map((r) => (
              <div key={r.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-medium">
                      {fmtUsd(Number(r.amountUsd))} · {r.account.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Received {fmtDate(r.receivedAt)} · Recorded by {r.recordedBy.fullName}
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                    {r.statusUpdatedAt ? (
                      <div className="text-xs text-muted-foreground">
                        Status updated {fmtDateTime(r.statusUpdatedAt)}
                        {r.statusNote ? ` · ${r.statusNote}` : ""}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-muted/40">
                      {fundLabel(r.fundStatus)}
                    </span>
                    <form action={deleteClientPaymentReceipt}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="receiptId" value={r.id} />
                      <button type="submit" className="text-xs text-red-600 underline">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>

                <FundStatusForm
                  projectId={project.id}
                  receiptId={r.id}
                  currentStatus={r.fundStatus}
                  action={updateReceiptFundStatus}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
