"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

const OPTIONS: { value: string; label: string }[] = [
  { value: "IN_HAND", label: "In Hand" },
  { value: "UTILIZED", label: "Utilized" },
  { value: "SETTLED_TO_WREDD_FBL", label: "Settled to WREDD FBL" },
];

export function FundStatusForm(props: {
  projectId: string;
  receiptId: string;
  currentStatus: string;
  action: (formData: FormData) => void;
  returnTo?: string;
}) {
  const { projectId, receiptId, currentStatus, action, returnTo } = props;
  const [status, setStatus] = React.useState(currentStatus);
  const [editingNote, setEditingNote] = React.useState(false);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="receiptId" value={receiptId} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <select
        name="fundStatus"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="h-8 rounded-md border bg-background px-2 text-xs"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {editingNote ? (
        <input
          name="statusNote"
          placeholder="Note (optional)"
          className="h-8 rounded-md border bg-background px-2 text-xs w-40"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingNote(true)}
          className="text-xs underline text-muted-foreground"
        >
          + note
        </button>
      )}

      <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs">
        Update
      </Button>
    </form>
  );
}
