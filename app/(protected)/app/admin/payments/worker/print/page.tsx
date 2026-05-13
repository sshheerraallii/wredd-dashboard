import { redirect } from "next/navigation";
import Link from "next/link";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app?err=forbidden");
  }
}

function fmtMoney(v: any) {
  try {
    const n = typeof v === "string" ? Number(v) : Number(v?.toString?.() ?? v);
    if (Number.isFinite(n)) return n.toFixed(2);
  } catch {}
  return String(v ?? "");
}

function fmtDate(d?: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

function AutoPrint() {
  "use client";
  const React = require("react");
  React.useEffect(() => {
    window.print();
  }, []);
  return null;
}

export default async function WorkerPaymentsPrintPage({
  searchParams,
}: {
  searchParams?: { workerId?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");
  requireManagerOrAdmin((session.user as any)?.role);

  const workerId = (searchParams?.workerId ?? "").trim();
  if (!workerId) redirect("/app/admin/payments/worker?err=missing_worker");

  const worker = await prisma.user.findUnique({
    where: { id: workerId },
    select: { fullName: true, username: true },
  });

  const lines = await prisma.projectPaymentLine.findMany({
    where: { userId: workerId, NOT: { status: "VOIDED" as any } } as any,
    select: {
      id: true,
      amount: true,
      status: true,
      payableOn: true,
      paidAt: true,
      note: true,
      project: { select: { id: true, title: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { payableOn: "asc" }, { createdAt: "desc" }],
    take: 5000,
  });

  const unpaid = lines.filter((l) => l.status === "UNPAID");
  const unpaidTotal = unpaid.reduce(
    (s, l) => s + Number(l.amount?.toString?.() ?? l.amount ?? 0),
    0
  );

  return (
    <div className="p-6 space-y-4">
      <AutoPrint />

      <style>{`
        @media print {
          a, button { display: none !important; }
          .no-print { display: none !important; }
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; vertical-align: top; }
        th { background: #f6f6f6; text-align: left; }
      `}</style>

      <div className="no-print">
        <Link
          className="underline"
          href={`/app/admin/payments/worker?workerId=${encodeURIComponent(workerId)}&tab=due`}
        >
          Back
        </Link>
      </div>

      <div>
        <div className="text-xl font-semibold">Worker Payments</div>
        <div className="text-sm text-muted-foreground">
          Worker: {worker?.fullName ?? "—"} ({worker?.username ?? "—"}) • Generated:{" "}
          {new Date().toLocaleString()}
        </div>
        <div className="text-sm">
          <b>Unpaid total:</b> {fmtMoney(unpaidTotal)}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Project / Reason</th>
            <th>Amount</th>
            <th>Payable On</th>
            <th>Status</th>
            <th>Paid At</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>
                <div style={{ fontWeight: 600 }}>
                  {l.project?.title ? l.project.title : "Manual entry"}
                </div>
                {l.note ? <div style={{ color: "#666" }}>Reason: {l.note}</div> : null}
              </td>
              <td>{fmtMoney(l.amount)}</td>
              <td>{fmtDate(l.payableOn)}</td>
              <td>{l.status}</td>
              <td>{fmtDate(l.paidAt)}</td>
            </tr>
          ))}

          {!lines.length ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#777", padding: "20px" }}>
                No items.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
