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

type AccountOpt = { id: string; name: string };

export function AddReceiptDialog(props: {
  projectId: string;
  accounts: AccountOpt[];
  action: (formData: FormData) => void;
}) {
  const { projectId, accounts, action } = props;
  const [open, setOpen] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">Mark Payment Received</Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a client payment</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            action(fd);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="projectId" value={projectId} />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Amount (USD)</label>
              <Input name="amount" type="number" step="0.01" min="0.01" placeholder="e.g. 500" required />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Date Received</label>
              <Input name="receivedAt" type="date" defaultValue={today} required />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Account</label>
            <select
              name="accountId"
              required
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Choose an account
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {accounts.length === 0 ? (
              <div className="text-xs text-amber-600">
                No active accounts yet — add one from Manage Accounts first.
              </div>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Note (optional)</label>
            <Input name="note" placeholder="e.g. partial payment, second installment" />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={accounts.length === 0}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
