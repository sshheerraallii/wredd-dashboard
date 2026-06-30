// app/(protected)/app/admin/targets/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { requireRole } from "@/lib/guards";
import { getPrisma } from "@/lib/prisma";
import { SYSTEM_BD_KEY, SYSTEM_BD_EMAIL } from "@/lib/bd-commission/constants";
import { openMonth, saveWorkingDays, snapshotMonth } from "./actions";
import AllocationEditor from "./_components/allocation-editor";
import { computeTargets } from "@/lib/bd-targets/compute";
import { Headline, DeptCard, BdTable, SnapshotHistory } from "@/components/bd-targets/ui";
import { PendingForm, PendingPlainSubmitButton } from "@/components/forms/pending-form";

const prisma = getPrisma();

function nowMonthKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toNum(v: any): number {
  if (v == null) return 0;
  const n = Number(typeof v === "string" ? v : v.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

export default async function BdTargetsPage({
  searchParams,
}: {
  searchParams: { monthKey?: string; err?: string; ok?: string; msg?: string };
}) {
  await requireRole(["SUPER_ADMIN"]);

  const selected = searchParams.monthKey ?? nowMonthKeyUTC();
  const err = searchParams.err ? decodeURIComponent(searchParams.err) : null;
  const okMsg = searchParams.ok ? (searchParams.msg ? decodeURIComponent(searchParams.msg) : "Saved.") : null;

  // Hardcoded department mapping (matches seed: by name or slug).
  const allDepts = await prisma.department.findMany({ select: { id: true, name: true, slug: true } });
  const findDept = (name: string, slug: string) =>
    allDepts.find((d) => d.name === name) ?? allDepts.find((d) => d.slug === slug) ?? null;
  const animations = findDept("Animations", "animations");
  const videoEditing = findDept("Video Editing", "video-editing");

  const departments = [
    animations ? { id: animations.id, name: "Animations" } : null,
    videoEditing ? { id: videoEditing.id, name: "Video Editing" } : null,
  ].filter(Boolean) as { id: string; name: string }[];

  // BDs: active BUSINESS_DEVELOPER, System BD always included & sorted first.
  const bdUsers = await prisma.user.findMany({
    where: { role: "BUSINESS_DEVELOPER" as any, archivedAt: null },
    orderBy: [{ fullName: "asc" }],
    select: { id: true, fullName: true, username: true, email: true },
  });
  const bds = bdUsers
    .map((b) => ({
      id: b.id,
      name: b.fullName,
      isSystem: b.username === SYSTEM_BD_KEY || b.email === SYSTEM_BD_EMAIL,
    }))
    .sort((a, b) => (a.isSystem === b.isSystem ? 0 : a.isSystem ? -1 : 1));

  // Existing allocation rows for the selected month.
  const deptIds = departments.map((d) => d.id);
  const existing = deptIds.length
    ? await prisma.bdDepartmentAllocation.findMany({
        where: { monthKey: selected, departmentId: { in: deptIds } },
        select: { bdId: true, departmentId: true, sharePercent: true },
      })
    : [];

  let initial: Record<string, number> = {};
  let copiedFrom: string | null = null;

  if (existing.length > 0) {
    for (const r of existing) initial[`${r.bdId}:${r.departmentId}`] = toNum(r.sharePercent);
  } else if (deptIds.length) {
    // Copy-forward: most recent prior month that has rows (form-only, unsaved).
    const prior = await prisma.bdDepartmentAllocation.findFirst({
      where: { monthKey: { lt: selected }, departmentId: { in: deptIds } },
      orderBy: { monthKey: "desc" },
      select: { monthKey: true },
    });
    if (prior) {
      const priorRows = await prisma.bdDepartmentAllocation.findMany({
        where: { monthKey: prior.monthKey, departmentId: { in: deptIds } },
        select: { bdId: true, departmentId: true, sharePercent: true },
      });
      for (const r of priorRows) initial[`${r.bdId}:${r.departmentId}`] = toNum(r.sharePercent);
      copiedFrom = prior.monthKey;
    }
  }

  // Working days for the month.
  const cfg = await prisma.monthlyFinanceConfig.findUnique({
    where: { monthKey: selected },
    select: { workingDays: true },
  });
  const workingDays = cfg?.workingDays ?? null;

  // Live dashboard computation for the headline + breakdown.
  const comp = await computeTargets(selected);

  // Snapshot history (closed-book) + this month's snapshot status.
  const snapshotRows = await prisma.bdTargetSnapshot.findMany({
    orderBy: [{ monthKey: "desc" }, { departmentName: "asc" }],
    select: { monthKey: true, departmentName: true, targetUsd: true, achievedUsd: true, snapshotAt: true },
  });
  const selectedSnapshotAt =
    snapshotRows.find((r) => r.monthKey === selected)?.snapshotAt ?? null;
  const historyRows = snapshotRows.map((r) => ({
    monthKey: r.monthKey,
    departmentName: r.departmentName,
    targetUsd: Number(r.targetUsd?.toString?.() ?? r.targetUsd ?? 0),
    achievedUsd: Number(r.achievedUsd?.toString?.() ?? r.achievedUsd ?? 0),
    snapshotAt: r.snapshotAt.toISOString(),
  }));

  // Month list for the picker (union of allocation + finance months).
  const [allocMonths, cfgMonths] = await Promise.all([
    prisma.bdDepartmentAllocation.findMany({ select: { monthKey: true }, distinct: ["monthKey"] }),
    prisma.monthlyFinanceConfig.findMany({ select: { monthKey: true }, orderBy: { monthKey: "desc" } }),
  ]);
  const months = Array.from(
    new Set([selected, ...allocMonths.map((m) => m.monthKey), ...cfgMonths.map((m) => m.monthKey)])
  ).sort((a, b) => (a < b ? 1 : -1));

  const setupMissing = departments.length < 2;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BD Targets</h1>
        <p className="text-sm text-muted-foreground">
          Set each BD&apos;s share of onsite capacity per department, and the month&apos;s working days. Targets and
          runway are computed from these.
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{okMsg}</div>
      ) : null}

      {setupMissing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Couldn&apos;t find both the &quot;Animations&quot; and &quot;Video Editing&quot; departments. Create them in
          Departments (by exact name or slug) to enable allocation.
        </div>
      ) : null}

      {/* ── Live dashboard (read-only overview) ───────────────────────── */}
      {comp.setupComplete ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Overview — {selected}</h2>
            <span className="text-[11px] text-muted-foreground">
              {comp.fxAssumed && comp.fxMonthKey ? `FX from ${comp.fxMonthKey}` : comp.fx > 0 ? "Live FX" : "No FX set"}
            </span>
          </div>
          <Headline totals={comp.totals} fx={comp.fx} />
          <div className="grid gap-4 sm:grid-cols-2">
            {comp.departments.map((d) => (
              <DeptCard key={d.key} dept={d} fx={comp.fx} />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">By Business Developer</h3>
            <BdTable bds={comp.bds} fx={comp.fx} />
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        {/* Left: month picker + working days */}
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Month</div>
            <PendingForm action={openMonth} className="flex gap-2">
              {(pending) => (
                <>
                  <input
                    name="monthKey"
                    defaultValue={selected}
                    placeholder="YYYY-MM"
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                    disabled={pending}
                  />
                  <PendingPlainSubmitButton
                    pending={pending}
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                  >
                    Open
                  </PendingPlainSubmitButton>
                </>
              )}
            </PendingForm>
            <div className="space-y-1 max-h-[280px] overflow-auto pr-1">
              {months.map((m) => (
                <a
                  key={m}
                  href={`/app/admin/targets?monthKey=${encodeURIComponent(m)}`}
                  className={[
                    "block rounded-xl border px-3 py-2 text-sm",
                    m === selected ? "bg-muted" : "hover:bg-muted/60",
                  ].join(" ")}
                >
                  {m}
                </a>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Working days</div>
            <p className="text-xs text-muted-foreground">
              Used for the daily rate and runway. Stored on the month&apos;s finance config.
            </p>
            <PendingForm action={saveWorkingDays} className="space-y-2">
              {(pending) => (
                <>
                  <input type="hidden" name="monthKey" value={selected} />
                  <input
                    name="workingDays"
                    inputMode="numeric"
                    defaultValue={workingDays ?? ""}
                    placeholder="e.g. 25"
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                    disabled={pending}
                  />
                  <PendingPlainSubmitButton
                    pending={pending}
                    className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                  >
                    Save working days
                  </PendingPlainSubmitButton>
                </>
              )}
            </PendingForm>
            {workingDays == null ? (
              <div className="text-[11px] text-amber-700">Not set for {selected} — runway can&apos;t be computed yet.</div>
            ) : null}
          </div>

          <div className="rounded-2xl border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Snapshot</div>
            <p className="text-xs text-muted-foreground">
              Freeze this month&apos;s target &amp; achieved (closed book). Re-snapshot to refresh.
            </p>
            <PendingForm action={snapshotMonth}>
              {(pending) => (
                <>
                  <input type="hidden" name="monthKey" value={selected} />
                  <PendingPlainSubmitButton
                    pending={pending}
                    className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                  >
                    {selectedSnapshotAt ? "Re-snapshot this month" : "Snapshot this month"}
                  </PendingPlainSubmitButton>
                </>
              )}
            </PendingForm>
            {selectedSnapshotAt ? (
              <div className="text-[11px] text-muted-foreground">
                Last snapshot: {new Date(selectedSnapshotAt).toISOString().slice(0, 16).replace("T", " ")} UTC
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">Not snapshotted yet.</div>
            )}
          </div>
        </div>

        {/* Right: allocation editor */}
        <div className="space-y-3">
          <div className="text-sm font-medium">Allocation — {selected}</div>
          {departments.length === 2 && bds.length > 0 ? (
            <AllocationEditor
              monthKey={selected}
              departments={departments}
              bds={bds}
              initial={initial}
              copiedFrom={copiedFrom}
            />
          ) : (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              {bds.length === 0 ? "No active business developers found." : "Department setup incomplete."}
            </div>
          )}
        </div>
      </div>

      {/* ── Snapshot history (closed book) ───────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Snapshot history</h2>
        <SnapshotHistory rows={historyRows} fx={comp.fx} />
      </div>
    </div>
  );
}
