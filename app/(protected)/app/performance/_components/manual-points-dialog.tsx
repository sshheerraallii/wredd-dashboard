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

export function ManualPointsDialog(props: {
  userId: string;
  period: string;
  monthKey: string;
  action: (formData: FormData) => void;
}) {
  const { userId, period, monthKey, action } = props;
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          Add Manual Points
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual performance points</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            action(fd);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="period" value={period} />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Type</label>
              <select
                name="sign"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                defaultValue="POSITIVE"
              >
                <option value="POSITIVE">Bonus (+)</option>
                <option value="NEGATIVE">Deduction (−)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Points</label>
              <Input
                name="amount"
                type="number"
                min={1}
                step={1}
                placeholder="e.g. 1"
                className="h-10"
              />
              <div className="text-xs text-muted-foreground">
                Whole number. Deduction is saved as negative.
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Month</label>
            <Input
              name="monthKey"
              defaultValue={monthKey}
              placeholder="YYYY-MM"
              className="h-10"
            />
            <div className="text-xs text-muted-foreground">
              Counts toward this month&apos;s points and accuracy. Defaults to the
              current month.
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Note (required)</label>
            <Input
              name="note"
              placeholder="e.g. Great attitude helping a teammate"
              className="h-10"
            />
            <div className="text-xs text-muted-foreground">
              Shown in the audit list so the reason is always recorded.
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="submit" size="sm">
              Save entry
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
