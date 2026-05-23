// =============================================================================
// FILE: app/(protected)/app/admin/animator-calculator/page.tsx
//
// PURPOSE: Animations Render Calculator — two tools in one page:
//
//   TOOL 1 — Salary → Target Points
//     Uses the animator's stored per-hour onsite rate (onsiteHourRatePkr)
//     which is the FULLY LOADED rate: salary + overhead already baked in.
//     This is the same rate used in BD profit calculations — one source of truth.
//     Manager picks the animator, enters FX rate + production multiple,
//     and gets back the exact monthly target points to set on their profile.
//
//   TOOL 2 — Project → Allowed Hours + Points to Award
//     Manager picks the animator and enters the project price (USD).
//     Video duration is IRRELEVANT for animators — price alone drives everything.
//     A 30-second and a 10-minute project at the same price get the same points,
//     but different animators get different allowed hours based on their salary.
//
// ROLES:   MANAGER and SUPER_ADMIN only
// DB:      Read-only. No writes. Manager enters results manually into projects.
//
// KEY DIFFERENCE FROM VIDEO EDITOR CALCULATOR:
//   Video editors  → per-minute rate × duration = project value
//   Animators      → project price is the input directly (no duration needed)
//   Video editors  → salary entered manually in Tool 1
//   Animators      → salary pulled from onsiteHourRatePkr stored on the user
// =============================================================================

export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { AnimatorCalculator } from "./_components/animator-calculator";

const prisma = getPrisma();

// Same role guard pattern used across all admin pages
function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app?err=forbidden");
  }
}

export default async function AnimatorCalculatorPage() {
  const session = await readSession();
  requireManagerOrAdmin(session?.user?.role);

  // Fetch all active (non-archived) onsite animators.
  //
  // We pull onsiteHourRatePkr here — this is the FULLY LOADED per-hour cost
  // in PKR (salary + overhead already included). Same value used in BD calcs.
  // If it's 0 or null, the calculator will show a warning to set it first.
  //
  // NOTE: If you ever add more animator worker types (e.g. ONSITE_3D_ANIMATOR),
  // add them to the `in` array below and they'll automatically appear.
  const animators = await prisma.user.findMany({
    where: {
      role: "ONSITE_EMPLOYEE",
      workerType: { in: ["ONSITE_ANIMATOR"] },
      archivedAt: null,
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      workerType: true,
      targetMonthlyPoints: true,  // used in Tool 2 (project calculator)
      onsiteHourRatePkr: true,    // used in Tool 1 (salary → points calculator)
                                  // this is the fully-loaded hourly cost in PKR
    },
    orderBy: { fullName: "asc" },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Animations Render Calculator
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
          Two tools in one. <strong>Tool 1</strong> — figure out the correct monthly
          target points for an animator based on their loaded hourly rate and your
          desired profit margin. <strong>Tool 2</strong> — calculate allowed hours
          and points to award for a specific animation project. Nothing saves
          automatically — results are entered manually.
        </p>
      </div>

      <AnimatorCalculator animators={animators} />
    </div>
  );
}