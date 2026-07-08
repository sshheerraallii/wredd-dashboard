"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FundStatusForm } from "./fund-status-form";
import type { LedgerRow } from "@/lib/client-payments/queries";

type AccountOpt = { id: string; name: string };

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date | string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function portalLabel(p: string) {
  if (p === "UPWORK") return "Upwork";
  if (p === "FIVERR") return "Fiverr";
  if (p === "DIRECT") return "Direct";
  return "Other";
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

export function ProjectPaymentPopup(props: {
  row: LedgerRow;
  accounts: AccountOpt[];
  returnTo: string;
  addAction: (formData: FormData) => void;
  updateStatusAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
}) {
  const { row, accounts, returnTo, addAction, updateStatusAction, deleteAction } = props;
  const [open, setOpen] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          Check Payment
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.title}</DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground -mt-2">
          {portalLabel(row.portal)} · {row.department?.name ?? "-"} · {row.bdOwner?.fullName ?? "No BD"} ·
          Completed {fmtDate(row.firstCompletedAt)}
        </div>

        {row.clientName || row.clientUsername ? (
          <div className="text-sm text-muted-foreground -mt-2">
            Client: {row.clientName ?? "-"}
            {row.clientUsername ? ` (@${row.clientUsername})` : ""}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Price</div>
            <div className="text-sm font-semibold">{fmtUsd(row.priceUsd)}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Portal Fee</div>
            <div className="text-sm font-semibold">{fmtUsd(row.feeUsd)}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Net Expected</div>
            <div className="text-sm font-semibold">{fmtUsd(row.netExpectedUsd)}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Received</div>
            <div className="text-sm font-semibold">{fmtUsd(row.totalReceived)}</div>
          </div>
          <div className="border rounded-lg p-3 col-span-3 md:col-span-1 flex flex-col justify-center">
            <div className="text-xs text-muted-foreground">Status</div>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full border text-xs w-fit ${statusClass(row.paymentStatus)}`}>
              {statusLabel(row.paymentStatus)}
            </span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-muted/20">
          <div className="text-sm font-medium mb-2">Record a payment</div>
          <form
            action={(fd) => {
              addAction(fd);
              setOpen(false);
            }}
            className="space-y-3"
          >
            <input type="hidden" name="projectId" value={row.id} />
            <input type="hidden" name="returnTo" value={returnTo} />

            <div className="grid gap-2 md:grid-cols-4">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs text-muted-foreground">Amount (USD)</label>
                <Input name="amount" type="number" step="0.01" min="0.01" placeholder="e.g. 500" required />
              </div>

              <div className="space-y-1 md:col-span-1">
                <label className="text-xs text-muted-foreground">Date</label>
                <Input name="receivedAt" type="date" defaultValue={today} required />
              </div>

              <div className="space-y-1 md:col-span-1">
                <label className="text-xs text-muted-foreground">Account</label>
                <select
                  name="accountId"
                  required
                  defaultValue=""
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    Choose
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1 md:col-span-1">
                <label className="text-xs text-muted-foreground">Note (optional)</label>
                <Input name="note" placeholder="e.g. 2nd installment" />
              </div>
            </div>

            {accounts.length === 0 ? (
              <div className="text-xs text-amber-600">
                No active accounts yet — add one from Manage Accounts first.
              </div>
            ) : (
              <div className="flex justify-end">
                <Button type="submit">Save Payment</Button>
              </div>
            )}
          </form>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Recorded Payments</div>

          {row.receipts.length === 0 ? (
            <div className="border rounded-lg px-4 py-6 text-sm text-muted-foreground text-center">
              Nothing recorded yet.
            </div>
          ) : (
            <div className="border rounded-lg divide-y">
              {row.receipts.map((r) => (
                <div key={r.id} className="px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{fmtUsd(r.amountUsd)}</span> · {r.account.name} ·{" "}
                      {fmtDate(r.receivedAt)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-muted/40">
                        {fundLabel(r.fundStatus)}
                      </span>
                      <form
                        action={(fd) => {
                          deleteAction(fd);
                        }}
                      >
                        <input type="hidden" name="projectId" value={row.id} />
                        <input type="hidden" name="receiptId" value={r.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" className="text-xs text-red-600 underline">
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>

                  <FundStatusForm
                    projectId={row.id}
                    receiptId={r.id}
                    currentStatus={r.fundStatus}
                    action={updateStatusAction}
                    returnTo={returnTo}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
