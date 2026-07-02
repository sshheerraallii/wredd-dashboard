// app/(protected)/app/admin/client-payments/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";
import { getClientPaymentsLedger, monthKeyFromDate, type PaymentStatus } from "@/lib/client-payments/queries";

const prisma = getPrisma();
const BASE_HREF = "/app/admin/client-payments";

type SearchParams = {
  monthKey?: string;
  departmentId?: string;
  bdId?: string;
  status?: string;
  ok?: string;
  err?: string;
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function statusLabel(s: PaymentStatus) {
  if (s === "FULLY_RECEIVED") return "Fully Received";
  if (s === "PARTIALLY_RECEIVED") return "Partially Received";
  return "Not Received";
}

function statusClass(s: PaymentStatus) {
  if (s === "FULLY_RECEIVED") return "bg-green-100 text-green-800 border-green-200";
  if (s === "PARTIALLY_RECEIVED") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function qp(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `${BASE_HREF}?${s}` : BASE_HREF;
}

export default async function ClientPaymentsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireRole(["SUPER_ADMIN"]);

  const monthKey = searchParams?.monthKey ?? monthKeyFromDate(new Date());
  const departmentId = searchParams?.departmentId ?? "";
  const bdId = searchParams?.bdId ?? "";
  const status = (searchParams?.status as PaymentStatus | "ALL" | undefined) ?? "ALL";

  const [rows, departments, bds] = await Promise.all([
    getClientPaymentsLedger({
      monthKey,
      departmentId: departmentId || undefined,
      bdId: bdId || undefined,
      status,
    }),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { role: "BUSINESS_DEVELOPER" },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
  ]);

  const totals = rows.reduce(
    (acc, r) => {
      acc.price += r.priceUsd;
      acc.received += r.totalReceived;
      return acc;
    },
    { price: 0, received: 0 }
  );

  const currentParams = { monthKey, departmentId, bdId, status: status === "ALL" ? undefined : status };
  const ok = searchParams?.ok;
  const err = searchParams?.err;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Client Payments</h1>
          <p className="text-sm text-muted-foreground">
            Track whether clients have paid for completed projects. Super Admin only.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`${BASE_HREF}/accounts`} className="text-sm underline">
            Manage Accounts
          </Link>
          <Link href={`${BASE_HREF}/settlement`} className="text-sm underline">
            Settlement View
          </Link>
        </div>
      </div>

      {ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <form className="flex flex-wrap gap-3 items-end border rounded-lg p-4 bg-muted/20">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Month</label>
          <input
            type="month"
            name="monthKey"
            defaultValue={monthKey}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Department</label>
          <select
            name="departmentId"
            defaultValue={departmentId}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">BD</label>
          <select name="bdId" defaultValue={bdId} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">All</option>
            {bds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="ALL">All</option>
            <option value="NOT_RECEIVED">Not Received</option>
            <option value="PARTIALLY_RECEIVED">Partially Received</option>
            <option value="FULLY_RECEIVED">Fully Received</option>
          </select>
        </div>

        <button className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm">
          Apply
        </button>
      </form>

      <div className="grid grid-cols-3 gap-3">
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Projects</div>
          <div className="text-lg font-semibold">{rows.length}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Total Priced</div>
          <div className="text-lg font-semibold">{fmtUsd(totals.price)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">Total Received</div>
          <div className="text-lg font-semibold">{fmtUsd(totals.received)}</div>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2 text-xs bg-muted/40 font-medium">
          <div className="col-span-4">Project</div>
          <div className="col-span-2">Completed</div>
          <div className="col-span-1 text-right">Price</div>
          <div className="col-span-1 text-right">Received</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Action</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">
            No completed projects match these filters.
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-12 px-4 py-3 text-sm items-center">
                <div className="col-span-4">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.department?.name ?? "-"} · {r.bdOwner?.fullName ?? "No BD"}
                  </div>
                </div>
                <div className="col-span-2 text-sm">{fmtDate(r.firstCompletedAt)}</div>
                <div className="col-span-1 text-right">{fmtUsd(r.priceUsd)}</div>
                <div className="col-span-1 text-right">{fmtUsd(r.totalReceived)}</div>
                <div className="col-span-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-xs ${statusClass(r.paymentStatus)}`}>
                    {statusLabel(r.paymentStatus)}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <Link href={`${BASE_HREF}/${r.id}`} className="text-sm underline">
                    Manage
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
