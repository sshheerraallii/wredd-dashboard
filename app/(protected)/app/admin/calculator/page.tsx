// =============================================================================
// FILE: app/(protected)/app/admin/calculator/page.tsx
//
// PURPOSE: Render Calculator — lets managers compute allowed hours + points
//          for onsite workers based on project rate and video duration.
//
// ROLES:   MANAGER and SUPER_ADMIN only (same guard used across admin pages)
// DB:      Read-only. Fetches active onsite workers and their point targets.
// WRITES:  None. Manager reads results and enters them into projects manually.
// =============================================================================

export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getOnsiteConstants } from "@/lib/onsite-points/settings";
import { RenderCalculator } from "./_components/render-calculator";

const prisma = getPrisma();

// Reuse the same role guard pattern used across all admin pages
function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app?err=forbidden");
  }
}

export default async function CalculatorPage() {
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  // Fetch all active (non-archived) onsite employees.
  // We only show ONSITE_EMPLOYEE because this calculator is for the
  // points system, which is onsite-only (remote workers don't use points).
  const workers = await prisma.user.findMany({
    where: {
      role: "ONSITE_EMPLOYEE",
      archivedAt: null, // exclude archived/former employees
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      targetMonthlyPoints: true, // the key value — set per salary
      workerType: true,          // e.g. ONSITE_VIDEO_EDITOR, ONSITE_ANIMATOR
    },
    orderBy: { fullName: "asc" },
  });

  // Global $ per point (single source of truth, set in Finance Config).
  const onsiteConstants = await getOnsiteConstants();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Render Calculator</h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
          Calculate the <strong>Allowed Hours</strong> and <strong>Points to Award</strong> for
          onsite workers on a project. Results are for manual entry — nothing is saved automatically.
        </p>
      </div>

      {/* Client-side interactive calculator */}
      <RenderCalculator workers={workers} dbDollarsPerPoint={onsiteConstants.dollarsPerPoint} />
    </div>
  );
}