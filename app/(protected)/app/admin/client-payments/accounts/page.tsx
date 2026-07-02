// app/(protected)/app/admin/client-payments/accounts/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";
import { createPaymentAccount, toggleAccountActive } from "./actions";

const prisma = getPrisma();

function typeLabel(t: string) {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

export default async function PaymentAccountsPage({
  searchParams,
}: {
  searchParams?: { ok?: string; err?: string };
}) {
  await requireRole(["SUPER_ADMIN"]);

  const accounts = await prisma.paymentAccount.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, ownerLabel: true, isActive: true },
  });

  const ok = searchParams?.ok;
  const err = searchParams?.err;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/app/admin/client-payments" className="text-sm underline text-muted-foreground">
          ← Back to Client Payments
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Payment Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Payoneers, Fiverr accounts, and bank accounts money can land in before it's settled to WREDD FBL.
        </p>
      </div>

      {ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <form action={createPaymentAccount} className="flex flex-wrap gap-2 items-end border rounded-lg p-4 bg-muted/20">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            name="name"
            placeholder="e.g. Payoneer 4"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            required
            minLength={2}
            maxLength={60}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <select name="type" defaultValue="OTHER" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="PAYONEER">Payoneer</option>
            <option value="FIVERR">Fiverr</option>
            <option value="BANK">Bank</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Owner (optional)</label>
          <input
            name="ownerLabel"
            placeholder="e.g. Gulzaib, WREDD"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            maxLength={60}
          />
        </div>

        <button className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm">Add</button>
      </form>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2 text-xs bg-muted/40 font-medium">
          <div className="col-span-4">Name</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-3">Owner</div>
          <div className="col-span-3 text-right">Action</div>
        </div>

        {accounts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No accounts yet.</div>
        ) : (
          <div className="divide-y">
            {accounts.map((a) => (
              <div key={a.id} className="grid grid-cols-12 px-4 py-3 text-sm items-center">
                <div className="col-span-4">{a.name}</div>
                <div className="col-span-2">{typeLabel(a.type)}</div>
                <div className="col-span-3">{a.ownerLabel ?? "-"}</div>
                <div className="col-span-3 text-right flex items-center justify-end gap-2">
                  {!a.isActive ? (
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-muted/40">Inactive</span>
                  ) : null}
                  <form action={toggleAccountActive}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="nextActive" value={a.isActive ? "0" : "1"} />
                    <button type="submit" className="text-xs underline">
                      {a.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
