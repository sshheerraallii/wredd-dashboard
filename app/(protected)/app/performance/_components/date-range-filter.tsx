"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * From / To calendar inputs for the Date Range performance tab.
 * Navigates with ?start=YYYY-MM-DD&end=YYYY-MM-DD, preserving userId.
 */
export function DateRangeFilter(props: {
  start: string;
  end: string;
  userId?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const [start, setStart] = React.useState(props.start);
  const [end, setEnd] = React.useState(props.end);

  React.useEffect(() => setStart(props.start), [props.start]);
  React.useEffect(() => setEnd(props.end), [props.end]);

  function apply() {
    if (!start || !end) return;
    const params = new URLSearchParams(sp.toString());
    params.set("tab", "date_range");
    params.set("start", start);
    params.set("end", end);
    if (props.userId) params.set("userId", props.userId);
    else params.delete("userId");
    router.push(`/app/performance?${params.toString()}`);
  }

  const invalid = !!start && !!end && start > end;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">From</label>
        <Input
          type="date"
          value={start}
          max={end || undefined}
          onChange={(e) => setStart(e.target.value)}
          className="h-9 w-[160px]"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">To</label>
        <Input
          type="date"
          value={end}
          min={start || undefined}
          onChange={(e) => setEnd(e.target.value)}
          className="h-9 w-[160px]"
        />
      </div>
      <Button onClick={apply} disabled={!start || !end || invalid} size="sm" className="h-9">
        Generate
      </Button>
      {invalid ? (
        <span className="text-xs text-red-600">From date must be on or before To date.</span>
      ) : null}
    </div>
  );
}
