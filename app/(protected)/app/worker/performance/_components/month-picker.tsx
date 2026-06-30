"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function labelFor(monthKey: string): string {
  const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
  if (!y || !m) return monthKey;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Single-month selector for the worker's own monthly tab. Navigates with
 * ?month=YYYY-MM&period=monthly; selecting a month re-runs the server
 * computations for that month.
 */
export function MonthPicker(props: { monthKeys: string[]; current: string }) {
  const { monthKeys, current } = props;
  const router = useRouter();
  const sp = useSearchParams();

  function onChange(value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", "monthly");
    params.set("month", value);
    params.delete("mPage");
    router.push(`/app/worker/performance?${params.toString()}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[150px] text-sm">
        <SelectValue placeholder="Select month" />
      </SelectTrigger>
      <SelectContent>
        {monthKeys.map((mk) => (
          <SelectItem key={mk} value={mk}>
            {labelFor(mk)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
