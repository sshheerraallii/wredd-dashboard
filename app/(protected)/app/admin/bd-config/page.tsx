import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { updateBdCommissionRate } from "./actions";
import { PendingForm, PendingPlainSubmitButton } from "@/components/forms/pending-form";

const prisma = getPrisma();

function asPercentString(v: any) {
  if (v == null) return "";
  try {
    const n = Number(v?.toString?.() ?? v);
    if (!Number.isFinite(n)) return "";
    return String(Math.round(n * 10000) / 100); // keep 2 decimals
  } catch {
    return "";
  }
}

export default async function AdminBdConfigPage() {
  const session = await readSession();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/app?err=forbidden");

  const bds = await prisma.user.findMany({
    where: { role: "BUSINESS_DEVELOPER" as any, archivedAt: null },
    orderBy: [{ fullName: "asc" }],
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      bdCommissionRate: true,
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">BD Configs</h1>
        <p className="text-sm text-muted-foreground">
          Super Admin-only. Commission rate is stored as a fraction (0.35 = 35%).
        </p>
      </div>

      <div className="rounded-2xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-3">BD</th>
                <th className="p-3">Username</th>
                <th className="p-3">Email</th>
                <th className="p-3">Commission %</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>

            <tbody>
              {bds.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={5}>
                    No BDs found.
                  </td>
                </tr>
              ) : (
                bds.map((bd) => (
                  <tr key={bd.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{bd.fullName}</div>
                      <div className="text-xs text-muted-foreground">{bd.id}</div>
                    </td>
                    <td className="p-3">{bd.username}</td>
                    <td className="p-3">{bd.email}</td>
                    <td className="p-3">
                      <PendingForm action={updateBdCommissionRate} className="flex items-center gap-2">
                        {(pending) => (
                          <>
                            <input type="hidden" name="userId" value={bd.id} />
                            <input
                              name="ratePercent"
                              defaultValue={asPercentString(bd.bdCommissionRate)}
                              placeholder="e.g. 35"
                              className="w-28 rounded-xl border bg-background px-3 py-2"
                              inputMode="decimal"
                              disabled={pending}
                            />
                            <PendingPlainSubmitButton
                              pending={pending}
                              className="rounded-xl border px-3 py-2 hover:bg-muted"
                            >
                              Save
                            </PendingPlainSubmitButton>
                          </>
                        )}
                      </PendingForm>
                      <div className="text-xs text-muted-foreground mt-1">
                        Current: {bd.bdCommissionRate?.toString?.() ?? "null"}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      Stored as fraction
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}