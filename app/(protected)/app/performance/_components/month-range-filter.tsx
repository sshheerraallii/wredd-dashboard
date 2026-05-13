"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANY = "__any__";

export function MonthRangeFilter(props: {
  monthKeys: string[];
  tab: string;
  userId: string;
}) {
  const { monthKeys, tab, userId } = props;

  const router = useRouter();
  const sp = useSearchParams();

  const currentPeriod = (sp.get("period") || "monthly").toLowerCase();
  const currentFrom = sp.get("from") || "";
  const currentTo = sp.get("to") || "";

  const [from, setFrom] = React.useState(currentFrom || ANY);
  const [to, setTo] = React.useState(currentTo || ANY);

  React.useEffect(() => setFrom(currentFrom || ANY), [currentFrom]);
  React.useEffect(() => setTo(currentTo || ANY), [currentTo]);

  function apply() {
    const params = new URLSearchParams(sp.toString());

    params.set("tab", tab);
    params.set("userId", userId);
    params.set("period", "overall");

    // reset month paging on filter change
    params.set("mPage", "1");

    if (from && from !== ANY) params.set("from", from);
    else params.delete("from");

    if (to && to !== ANY) params.set("to", to);
    else params.delete("to");

    router.push(`/app/performance?${params.toString()}`);
  }

  function clear() {
    const params = new URLSearchParams(sp.toString());

    params.set("tab", tab);
    params.set("userId", userId);
    params.set("period", "overall");

    params.delete("from");
    params.delete("to");
    params.set("mPage", "1");

    router.push(`/app/performance?${params.toString()}`);
  }

  const disabled = currentPeriod !== "overall";

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm font-medium">Overall range</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Filter months (YYYY-MM). Applies only to the Overall tab.
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="w-full sm:w-56">
          <div className="mb-1 text-xs text-muted-foreground">From</div>
          <Select value={from} onValueChange={setFrom} disabled={disabled}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Start month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>(Any)</SelectItem>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>
                  {mk}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full sm:w-56">
          <div className="mb-1 text-xs text-muted-foreground">To</div>
          <Select value={to} onValueChange={setTo} disabled={disabled}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="End month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>(Any)</SelectItem>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>
                  {mk}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={apply} disabled={disabled}>
            Apply
          </Button>
          <Button variant="ghost" onClick={clear} disabled={disabled}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
