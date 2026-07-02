// app/(protected)/app/admin/client-payments/settlement/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireRole } from "@/lib/guards";
import { getSettlementRollup, monthKeyFromDate } from "@/lib/client-payments/queries";

const BASE_HREF = "/app/admin/client-payments/settlement";

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function SettlementPage({
  searchParams,
}: {
  searchParams?: { monthKey?: string };
}) {
  await requireRole(["SUPER_ADMIN"]);

  const monthKey = searchParams?.monthKey ?? monthKeyFromDate(new Date());
  const rows = monthKey ? await getSettlementRollup(monthKey) : await getSettlementRollup();

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.inHand += r.inHand;
      acc.utilized += r.utilized;
      acc.settled += r.settled;
      return acc;
    },
    { total: 0, inHand: 0, utilized: 0, settled: 0 }
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/app/admin/client-payments" className="text-sm underline text-muted-foreground">
          ← Back to Client Payments
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Settlement</h1>
        <p className="text-sm text-muted-foreground">
          Money collected per account, and how much of it has moved to WREDD FBL.
        </p>
      </div>

      <form className="flex gap-3 items-end border rounded-lg p-4 bg-muted/20">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Month</label>
          <input
            type="month"
            name="monthKey"
            defaultValue={monthKey}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <button className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm">Apply</button>
        <Link href={BASE_HREF} className="text-sm underline text-muted-foreground">
          All Time
        </Link>
      </form>

      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Total Collected</div>
          <div className="text-lg font-semibold">{fmtUsd(totals.total)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">In Hand</div>
          <div className="text-lg font-semibold">{fmtUsd(totals.inHand)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Utilized</div>
          <div className="text-lg font-semibold">{fmtUsd(totals.utilized)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Settled to WREDD FBL</div>
          <div className="text-lg font-semibold">{fmtUsd(totals.settled)}</div>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2 text-xs bg-muted/40 font-medium">
          <div className="col-span-3">Account</div>
          <div className="col-span-2">Month</div>
          <div className="col-span-2 text-right">Total</div>
          <div className="col-span-2 text-right">In Hand</div>
          <div className="col-span-1 text-right">Utilized</div>
          <div className="col-span-2 text-right">Settled</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">
            No receipts recorded for this period.
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={`${r.accountId}:${r.monthKey}`} className="grid grid-cols-12 px-4 py-3 text-sm items-center">
                <div className="col-span-3 font-medium">{r.accountName}</div>
                <div className="col-span-2">{r.monthKey}</div>
                <div className="col-span-2 text-right">{fmtUsd(r.total)}</div>
                <div className="col-span-2 text-right">
                  {r.inHand > 0 ? (
                    <span className="text-amber-700 font-medium">{fmtUsd(r.inHand)}</span>
                  ) : (
                    fmtUsd(r.inHand)
                  )}
                </div>
                <div className="col-span-1 text-right">{fmtUsd(r.utilized)}</div>
                <div className="col-span-2 text-right">{fmtUsd(r.settled)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
