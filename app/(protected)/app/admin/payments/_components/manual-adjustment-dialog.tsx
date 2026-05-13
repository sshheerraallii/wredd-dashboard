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

type ProjectOpt = { id: string; title: string };

export function ManualAdjustmentDialog(props: {
  workerId: string;
  projects: ProjectOpt[];
  action: (formData: FormData) => void;
}) {
  const { workerId, projects, action } = props;

  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          Add Bonus / Fine
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual entry (Bonus / Fine)</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            action(fd);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="workerId" value={workerId} />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Type</label>
              <select
                name="kind"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                defaultValue="BONUS"
              >
                <option value="BONUS">Bonus (+)</option>
                <option value="FINE">Fine (-)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Amount</label>
              <Input name="amount" placeholder="e.g. 2500" className="h-10" />
              <div className="text-xs text-muted-foreground">
                Enter a positive number. Fine is saved as negative.
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Project (optional)</label>
            <input
              list="project_opts"
              name="projectId"
              placeholder="Optional: choose project"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
            <datalist id="project_opts">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </datalist>
            <div className="text-xs text-muted-foreground">
              Leave empty for a general bonus/fine not tied to a project.
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Reason / note</label>
            <Input name="reason" placeholder="Reason shown in Project column" className="h-10" />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create entry</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
