"use client";

// =============================================================================
// FILE: app/(protected)/app/admin/animator-calculator/_components/animator-calculator.tsx
//
// PURPOSE: Two-tool animator calculator. Pure client-side, zero DB writes.
//
// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1: SALARY → TARGET POINTS
// ─────────────────────────────────────────────────────────────────────────────
//
//   WHY: Each animator's monthly target points must be set on their profile.
//        This tool calculates the correct value from their loaded hourly rate.
//
//   INPUTS (from DB, auto-filled when animator is selected):
//     onsiteHourRatePkr  = fully loaded per-hour cost in PKR
//                          (salary + overhead baked in — same as BD calculations)
//
//   INPUTS (from manager, saved to localStorage):
//     fxRate             = PKR per 1 USD  (e.g. 270)
//     productionMultiple = how many times the cost the project must earn (e.g. 3)
//                          derived from 8 years of real project data:
//                          a $300 animation project takes ~25 hrs on average,
//                          which at the 120k animator's rate = ~3× cost recovery
//     workingDays        = working days per month (default 25)
//     effectiveHoursDay  = productive hours per day (default 6.5)
//     dollarsPerPoint    = how much $1 point is worth in USD (default $6)
//
//   FORMULA CHAIN:
//     hourlyUSD          = onsiteHourRatePkr ÷ fxRate
//     monthlyRevenueNeed = hourlyUSD × productionMultiple × effectiveHoursDay × workingDays
//     targetPoints       = monthlyRevenueNeed ÷ dollarsPerPoint
//
//   OUTPUT:
//     → Monthly Target Points to manually set on the animator's profile
//     → Full breakdown: hourly cost USD, daily budget, month revenue needed
//
// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2: PROJECT → ALLOWED HOURS + POINTS TO AWARD
// ─────────────────────────────────────────────────────────────────────────────
//
//   WHY: For each animation project, manager needs to know:
//        (a) how many hours to allow the animator
//        (b) how many points to award on completion
//
//   KEY INSIGHT: Duration of the animation is IRRELEVANT.
//     A 30-second and a 10-minute project at the same price get:
//       - identical points (price ÷ $6)
//       - DIFFERENT allowed hours depending on the animator's salary
//     A cheaper animator gets more time; an expensive one gets less.
//     This is fair: both hit 100% target if they work at their pace.
//
//   INPUTS:
//     projectPrice       = total project value in USD
//     animator           = selected from DB (pulls onsiteHourRatePkr + targetMonthlyPoints)
//
//   FORMULA CHAIN:
//     hourlyUSD          = onsiteHourRatePkr ÷ fxRate
//     allowedHours       = projectPrice ÷ (hourlyUSD × productionMultiple)
//     pointsToAward      = projectPrice ÷ dollarsPerPoint   ← SAME for all animators
//
//   OUTPUT:
//     → Allowed Hours  (enter into the project deadline field)
//     → Points to Award  (enter into onsite performance credits)
//
// ─────────────────────────────────────────────────────────────────────────────
// MONTH-END SANITY CHECK (built into both tools):
//   If animator works all 25 days × 6.5 hrs at their hourly rate,
//   and all projects are priced at the production multiple,
//   they will earn exactly their target points. The system is closed-loop. ✅
// =============================================================================

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

type Animator = {
  id: string;
  fullName: string;
  username: string;
  workerType: string | null;
  targetMonthlyPoints: number;
  onsiteHourRatePkr: number | null; // fully-loaded hourly cost in PKR
};

// Constants that apply to BOTH tools — user-adjustable, saved to localStorage
type Constants = {
  workingDays: number;          // working days per month
  effectiveHoursPerDay: number; // real productive hours (not 8h nominal)
  dollarsPerPoint: number;      // 1 point = $X of project value
  fxRate: number;               // PKR per 1 USD — needed to convert hourly cost
  productionMultiple: number;   // target revenue as multiple of cost (e.g. 3 = 3× cost recovery)
                                // derived from real data: $300 animation ≈ 25hrs on avg
};

// Which of the two tools is the user currently looking at
type ActiveTool = "salary_to_points" | "project_to_hours";

// ---------------------------------------------------------------------------
// DEFAULT CONSTANTS
// ─ Change these if business rules change permanently.
// ─ productionMultiple = 3 comes from 8 years of real animation project data.
//   At 3×, a $300 project on a 120k animator takes ~25 working hours.
// ---------------------------------------------------------------------------
const DEFAULT_CONSTANTS: Constants = {
  workingDays: 25,
  effectiveHoursPerDay: 6.5,
  dollarsPerPoint: 6,
  fxRate: 270,
  productionMultiple: 3,
};

// Separate localStorage key from video editor calculator to avoid conflicts
const STORAGE_KEY = "wredd:anim-calc:constants";

// ---------------------------------------------------------------------------
// CALCULATION ENGINES — one pure function per tool
// Pure = no side effects, easy to test, easy to read in the future
// ---------------------------------------------------------------------------

type Tool1Result = {
  hourlyUSD: number;          // onsiteHourRatePkr ÷ fxRate
  dailyBudgetUSD: number;     // hourlyUSD × effectiveHoursPerDay
  monthlyRevenueNeed: number; // dailyBudgetUSD × workingDays × productionMultiple
  targetPoints: number;       // monthlyRevenueNeed ÷ dollarsPerPoint  ← SET THIS ON PROFILE
  monthlyCostUSD: number;     // hourlyUSD × effectiveHoursPerDay × workingDays (break-even)
  monthlyProfitUSD: number;   // monthlyRevenueNeed - monthlyCostUSD
};

function runTool1(params: {
  onsiteHourRatePkr: number;
  fxRate: number;
  productionMultiple: number;
  workingDays: number;
  effectiveHoursPerDay: number;
  dollarsPerPoint: number;
}): Tool1Result | null {
  const { onsiteHourRatePkr, fxRate, productionMultiple, workingDays, effectiveHoursPerDay, dollarsPerPoint } = params;

  // Guard: all values must be positive
  if (!onsiteHourRatePkr || !fxRate || !productionMultiple || !workingDays || !effectiveHoursPerDay || !dollarsPerPoint) return null;
  if (onsiteHourRatePkr <= 0 || fxRate <= 0 || productionMultiple <= 0) return null;

  // Step 1: Convert PKR hourly rate to USD
  // This is the same rate used in BD profit calculations — one source of truth
  const hourlyUSD = onsiteHourRatePkr / fxRate;

  // Step 2: Daily earning capacity in USD (how much revenue this animator generates per day)
  const dailyBudgetUSD = hourlyUSD * effectiveHoursPerDay;

  // Step 3: Monthly cost (break-even — what the company pays this animator per month in USD)
  const monthlyCostUSD = dailyBudgetUSD * workingDays;

  // Step 4: Monthly revenue needed to hit the production multiple
  // PM=3 means: for every $1 this animator costs, company wants $3 in project revenue
  const monthlyRevenueNeed = monthlyCostUSD * productionMultiple;

  // Step 5: Convert to points (at $6/point)
  // This is the number to SET on the animator's profile in Users > Edit
  const targetPoints = monthlyRevenueNeed / dollarsPerPoint;

  // Step 6: Profit at 100% performance
  const monthlyProfitUSD = monthlyRevenueNeed - monthlyCostUSD;

  return { hourlyUSD, dailyBudgetUSD, monthlyRevenueNeed, targetPoints, monthlyCostUSD, monthlyProfitUSD };
}

type Tool2Result = {
  hourlyUSD: number;      // onsiteHourRatePkr ÷ fxRate
  allowedHours: number;   // projectPrice ÷ (hourlyUSD × productionMultiple)  ← ENTER INTO PROJECT
  pointsToAward: number;  // projectPrice ÷ dollarsPerPoint  ← SAME FOR ALL ANIMATORS
  costToCompany: number;  // allowedHours × hourlyUSD  (what this project costs in labour)
  impliedProfit: number;  // projectPrice - costToCompany
};

function runTool2(params: {
  projectPrice: number;
  onsiteHourRatePkr: number;
  fxRate: number;
  productionMultiple: number;
  dollarsPerPoint: number;
}): Tool2Result | null {
  const { projectPrice, onsiteHourRatePkr, fxRate, productionMultiple, dollarsPerPoint } = params;

  // Guard: all values must be positive
  if (!projectPrice || !onsiteHourRatePkr || !fxRate || !productionMultiple || !dollarsPerPoint) return null;
  if (projectPrice <= 0 || onsiteHourRatePkr <= 0 || fxRate <= 0) return null;

  // Step 1: Animator's hourly cost in USD
  const hourlyUSD = onsiteHourRatePkr / fxRate;

  // Step 2: Allowed hours — how many hours should this project take?
  //
  //   allowedHours = projectPrice ÷ (hourlyUSD × PM)
  //
  //   WHY: The production multiple (PM=3) means for every hour worked,
  //        the project must earn PM× that hour's cost. Rearranging:
  //        hours = price ÷ (cost_per_hour × PM)
  //
  //   THIS DIFFERS PER ANIMATOR: a cheaper animator gets more hours;
  //   an expensive one gets fewer. Both earn the same points.
  const allowedHours = projectPrice / (hourlyUSD * productionMultiple);

  // Step 3: Points to award — SAME for all animators on this project.
  //   Points are purely price-driven, not salary-driven.
  //   This is intentional: a $300 project is a $300 project regardless of who did it.
  const pointsToAward = projectPrice / dollarsPerPoint;

  // Step 4: What this project actually costs the company in labour
  const costToCompany = allowedHours * hourlyUSD;

  // Step 5: Implied profit (before BD commission)
  const impliedProfit = projectPrice - costToCompany;

  return { hourlyUSD, allowedHours, pointsToAward, costToCompany, impliedProfit };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function fmt2(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function fmtPKR(n: number) {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n) + " PKR";
}

function fmtHours(n: number) {
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function pct(part: number, whole: number) {
  if (!whole) return "0%";
  return ((part / whole) * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

export function AnimatorCalculator({
  animators,
  dbConstants,
}: {
  animators: Animator[];
  dbConstants: { productionMultiple: number; dollarsPerPoint: number };
}) {
  const [activeTool, setActiveTool] = useState<ActiveTool>("salary_to_points");

  // --- Shared constants (both tools use these) ---
  // productionMultiple + dollarsPerPoint are GLOBAL (set in Finance Config) and
  // seeded from the DB here — they are read-only on this page. The remaining
  // knobs (fxRate, workingDays, effectiveHoursPerDay) stay local + localStorage.
  const [constants, setConstants] = useState<Constants>({
    ...DEFAULT_CONSTANTS,
    productionMultiple: dbConstants.productionMultiple,
    dollarsPerPoint: dbConstants.dollarsPerPoint,
  });
  const [constantsOpen, setConstantsOpen] = useState(false);

  // Load saved constants from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Constants>;
        // Note: productionMultiple + dollarsPerPoint are intentionally NOT
        // loaded from localStorage — they come from the DB (Finance Config).
        setConstants((prev) => ({
          ...prev,
          workingDays:          parsed.workingDays          ?? prev.workingDays,
          effectiveHoursPerDay: parsed.effectiveHoursPerDay ?? prev.effectiveHoursPerDay,
          fxRate:               parsed.fxRate               ?? prev.fxRate,
        }));
      }
    } catch {
      // localStorage unavailable or corrupted — silently use defaults
    }
  }, []);

  const updateConstants = useCallback((patch: Partial<Constants>) => {
    setConstants((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const resetConstants = () => {
    setConstants({
      ...DEFAULT_CONSTANTS,
      // Keep the global (DB-sourced) values; only local knobs reset.
      productionMultiple: dbConstants.productionMultiple,
      dollarsPerPoint: dbConstants.dollarsPerPoint,
    });
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  // --- Tool 1 state ---
  const [tool1AnimatorId, setTool1AnimatorId] = useState("");

  // --- Tool 2 state ---
  const [tool2AnimatorId, setTool2AnimatorId] = useState("");
  const [projectPriceStr, setProjectPriceStr] = useState("");

  // --- Derived data ---
  const tool1Animator = animators.find((a) => a.id === tool1AnimatorId) ?? null;
  const tool2Animator = animators.find((a) => a.id === tool2AnimatorId) ?? null;

  // Run Tool 1 calculation
  const tool1Result =
    tool1Animator?.onsiteHourRatePkr
      ? runTool1({
          onsiteHourRatePkr: tool1Animator.onsiteHourRatePkr,
          fxRate: constants.fxRate,
          productionMultiple: constants.productionMultiple,
          workingDays: constants.workingDays,
          effectiveHoursPerDay: constants.effectiveHoursPerDay,
          dollarsPerPoint: constants.dollarsPerPoint,
        })
      : null;

  // Run Tool 2 calculation
  const projectPrice = parseFloat(projectPriceStr);
  const tool2Result =
    tool2Animator?.onsiteHourRatePkr && Number.isFinite(projectPrice) && projectPrice > 0
      ? runTool2({
          projectPrice,
          onsiteHourRatePkr: tool2Animator.onsiteHourRatePkr,
          fxRate: constants.fxRate,
          productionMultiple: constants.productionMultiple,
          dollarsPerPoint: constants.dollarsPerPoint,
        })
      : null;

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">

      {/* ================================================================
          SHARED SETTINGS PANEL
          All constants used by both tools. Saved to localStorage.
          Key ones: FX rate (changes monthly) and Production Multiple (3×
          from 8 years of real data — change only if business model shifts).
      ================================================================ */}
      <div className="rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setConstantsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
        >
          <div>
            <span className="font-medium text-sm">⚙️ Calculator Settings</span>
            <span className="ml-3 text-xs text-muted-foreground">
              {constants.workingDays} days · {constants.effectiveHoursPerDay}h/day ·
              ${constants.dollarsPerPoint}/pt · {constants.fxRate} PKR/$ ·
              {constants.productionMultiple}× multiple
            </span>
          </div>
          <span className="text-muted-foreground text-xs">
            {constantsOpen ? "▲ collapse" : "▼ edit"}
          </span>
        </button>

        {constantsOpen && (
          <div className="border-t px-5 py-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              <strong>FX Rate</strong>, working days and hours/day are saved in your
              browser for what-if math. <strong>Production Multiple</strong> and{" "}
              <strong>$ per Point</strong> are global business constants set in{" "}
              <a href="/app/admin/finance-config" className="underline hover:text-foreground">
                Finance Config
              </a>{" "}
              — shown here read-only so this calculator always matches the live values.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* FX Rate — most likely to change, so shown first */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  FX Rate (PKR per $1)
                </span>
                <input
                  type="number" min={1} step={1}
                  value={constants.fxRate}
                  onChange={(e) => updateConstants({ fxRate: parseFloat(e.target.value) || DEFAULT_CONSTANTS.fxRate })}
                  className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
                <span className="text-xs text-muted-foreground">Default: 270</span>
              </label>

              {/* Production Multiple — global, set in Finance Config (read-only) */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Production Multiple
                </span>
                <div className="mt-1.5 w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
                  <span className="font-medium">{constants.productionMultiple}×</span>
                  <a href="/app/admin/finance-config" className="text-xs text-muted-foreground underline hover:text-foreground">
                    Finance Config
                  </a>
                </div>
                <span className="text-xs text-muted-foreground">Global · read-only</span>
              </label>

              {/* Working days */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Working Days / Month
                </span>
                <input
                  type="number" min={1} max={31} step={1}
                  value={constants.workingDays}
                  onChange={(e) => updateConstants({ workingDays: parseFloat(e.target.value) || DEFAULT_CONSTANTS.workingDays })}
                  className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
                <span className="text-xs text-muted-foreground">Default: 25</span>
              </label>

              {/* Effective hours per day */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Effective Hours / Day
                </span>
                <input
                  type="number" min={1} max={12} step={0.5}
                  value={constants.effectiveHoursPerDay}
                  onChange={(e) => updateConstants({ effectiveHoursPerDay: parseFloat(e.target.value) || DEFAULT_CONSTANTS.effectiveHoursPerDay })}
                  className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
                <span className="text-xs text-muted-foreground">Default: 6.5</span>
              </label>

              {/* $ per point — global, set in Finance Config (read-only) */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  $ per Point
                </span>
                <div className="mt-1.5 w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
                  <span className="font-medium">${constants.dollarsPerPoint}</span>
                  <a href="/app/admin/finance-config" className="text-xs text-muted-foreground underline hover:text-foreground">
                    Finance Config
                  </a>
                </div>
                <span className="text-xs text-muted-foreground">Global · read-only</span>
              </label>
            </div>

            <button
              type="button"
              onClick={resetConstants}
              className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
            >
              Reset all to defaults
            </button>
          </div>
        )}
      </div>

      {/* ================================================================
          TOOL SWITCHER
          Two distinct tools — visually separated so manager knows exactly
          which task they're performing.
      ================================================================ */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTool("salary_to_points")}
          className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
            activeTool === "salary_to_points"
              ? "bg-foreground text-background border-foreground"
              : "bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <div className="font-semibold text-sm">Tool 1</div>
          <div className={`text-xs mt-0.5 ${activeTool === "salary_to_points" ? "opacity-70" : ""}`}>
            Animator Salary → Target Points
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTool("project_to_hours")}
          className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
            activeTool === "project_to_hours"
              ? "bg-foreground text-background border-foreground"
              : "bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <div className="font-semibold text-sm">Tool 2</div>
          <div className={`text-xs mt-0.5 ${activeTool === "project_to_hours" ? "opacity-70" : ""}`}>
            Project Price → Allowed Hours + Points
          </div>
        </button>
      </div>

      {/* ================================================================
          TOOL 1: SALARY → TARGET POINTS
          Manager picks animator → sees their loaded hourly rate → gets
          the exact monthly target points to set on their profile.
      ================================================================ */}
      {activeTool === "salary_to_points" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card px-5 py-5 space-y-4">
            <div>
              <h2 className="font-semibold text-sm">Select Animator</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Their fully-loaded hourly rate (salary + overhead) is pulled automatically
                from their profile. This is the same rate used in BD profit calculations.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Animator
                </span>
                <select
                  value={tool1AnimatorId}
                  onChange={(e) => setTool1AnimatorId(e.target.value)}
                  className="mt-1.5 block w-72 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                >
                  <option value="">— Pick an animator —</option>
                  {animators.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName} (@{a.username})
                    </option>
                  ))}
                </select>
              </label>

              {/* Show the pulled hourly rate for transparency */}
              {tool1Animator && (
                <div className="pb-2 space-y-0.5">
                  {tool1Animator.onsiteHourRatePkr ? (
                    <>
                      <div className="text-xs text-muted-foreground">Loaded hourly rate (from profile)</div>
                      <div className="font-semibold text-sm">
                        {fmtPKR(tool1Animator.onsiteHourRatePkr)}
                        <span className="ml-2 font-normal text-muted-foreground text-xs">
                          = ${fmt2(tool1Animator.onsiteHourRatePkr / constants.fxRate)}/hr USD
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Current target on profile: {tool1Animator.targetMonthlyPoints} pts
                      </div>
                    </>
                  ) : (
                    // Warning: rate not set on this profile yet
                    <div className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ No hourly rate set on this animator's profile yet.
                      Go to Users → Edit to set onsiteHourRatePkr first.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tool 1 Result */}
          {tool1Result && tool1Animator && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b bg-muted/40 flex items-center justify-between">
                <div>
                  <span className="font-semibold">{tool1Animator.fullName}</span>
                  <span className="text-sm text-muted-foreground ml-2">@{tool1Animator.username}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtPKR(tool1Animator.onsiteHourRatePkr!)} · {constants.productionMultiple}× multiple
                </div>
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* PRIMARY OUTPUT — the one number the manager needs */}
                <div className="rounded-xl bg-foreground text-background px-5 py-4">
                  <div className="text-xs opacity-70 uppercase tracking-wide font-medium">
                    Monthly Target Points to Set
                  </div>
                  <div className="text-4xl font-bold mt-1">
                    {Math.round(tool1Result.targetPoints)} pts
                  </div>
                  <div className="text-xs opacity-60 mt-1">
                    Go to Users → {tool1Animator.fullName} → Edit → set targetMonthlyPoints to {Math.round(tool1Result.targetPoints)}
                  </div>
                </div>

                {/* PROFIT SUMMARY */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Monthly Cost</div>
                    <div className="font-semibold mt-0.5">${fmt2(tool1Result.monthlyCostUSD)}</div>
                    <div className="text-xs text-muted-foreground">break-even</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Revenue Needed</div>
                    <div className="font-semibold mt-0.5">${fmt2(tool1Result.monthlyRevenueNeed)}</div>
                    <div className="text-xs text-muted-foreground">at 100% performance</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Monthly Profit</div>
                    <div className="font-semibold mt-0.5">${fmt2(tool1Result.monthlyProfitUSD)}</div>
                    <div className="text-xs text-muted-foreground">
                      {pct(tool1Result.monthlyProfitUSD, tool1Result.monthlyRevenueNeed)} margin
                    </div>
                  </div>
                </div>

                {/* FULL BREAKDOWN */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Calculation Breakdown
                  </div>
                  <div className="space-y-2">
                    <BreakdownRow
                      label="Hourly rate (USD)"
                      formula={`${fmtPKR(tool1Animator.onsiteHourRatePkr!)} ÷ ${constants.fxRate} PKR/$`}
                      value={`$${fmt2(tool1Result.hourlyUSD)}/hr`}
                    />
                    <BreakdownRow
                      label="Daily earning capacity"
                      formula={`$${fmt2(tool1Result.hourlyUSD)} × ${constants.effectiveHoursPerDay}h`}
                      value={`$${fmt2(tool1Result.dailyBudgetUSD)}/day`}
                    />
                    <BreakdownRow
                      label="Monthly cost (break-even)"
                      formula={`$${fmt2(tool1Result.dailyBudgetUSD)} × ${constants.workingDays} days`}
                      value={`$${fmt2(tool1Result.monthlyCostUSD)}`}
                    />
                    <BreakdownRow
                      label={`Revenue needed (${constants.productionMultiple}× multiple)`}
                      formula={`$${fmt2(tool1Result.monthlyCostUSD)} × ${constants.productionMultiple}`}
                      value={`$${fmt2(tool1Result.monthlyRevenueNeed)}`}
                    />
                    <div className="border-t pt-2 mt-2">
                      <BreakdownRow
                        label="Target Points"
                        formula={`$${fmt2(tool1Result.monthlyRevenueNeed)} ÷ $${constants.dollarsPerPoint}/pt`}
                        value={`${fmt2(tool1Result.targetPoints)} pts`}
                        highlight
                      />
                    </div>
                  </div>
                </div>

                {/* SANITY NOTE */}
                <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">What this means:</span>{" "}
                  If {tool1Animator.fullName.split(" ")[0]} completes animation projects
                  worth ${fmt2(tool1Result.dailyBudgetUSD * constants.productionMultiple)} per
                  day for all {constants.workingDays} days, they earn{" "}
                  <span className="font-medium text-foreground">
                    {Math.round(tool1Result.targetPoints)} points = 100% of target.
                  </span>
                  {" "}The company recovers cost + {pct(tool1Result.monthlyProfitUSD, tool1Result.monthlyRevenueNeed)} margin. ✅
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          TOOL 2: PROJECT → ALLOWED HOURS + POINTS TO AWARD
          Manager picks animator + enters project price.
          Duration is NOT needed — irrelevant for animators.
          Points are the same for all animators. Hours differ by salary.
      ================================================================ */}
      {activeTool === "project_to_hours" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card px-5 py-5 space-y-4">
            <div>
              <h2 className="font-semibold text-sm">Project Details</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                No duration needed — for animators, price alone determines points and time budget.
                A cheaper animator gets more hours on the same project; an expensive one gets fewer.
                Both earn the same points.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              {/* Animator picker */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Animator
                </span>
                <select
                  value={tool2AnimatorId}
                  onChange={(e) => setTool2AnimatorId(e.target.value)}
                  className="mt-1.5 block w-72 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                >
                  <option value="">— Pick an animator —</option>
                  {animators.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName} (@{a.username})
                    </option>
                  ))}
                </select>
              </label>

              {/* Project price */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Project Price (USD)
                </span>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <input
                    type="number" min={0} step={0.01}
                    placeholder="e.g. 300"
                    value={projectPriceStr}
                    onChange={(e) => setProjectPriceStr(e.target.value)}
                    className="w-44 rounded-lg border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                  />
                </div>
              </label>

              {/* Show hourly rate badge when animator is selected */}
              {tool2Animator && (
                <div className="pb-2 space-y-0.5">
                  {tool2Animator.onsiteHourRatePkr ? (
                    <>
                      <div className="text-xs text-muted-foreground">Hourly rate</div>
                      <div className="text-sm font-semibold">
                        {fmtPKR(tool2Animator.onsiteHourRatePkr)}
                        <span className="ml-2 font-normal text-muted-foreground text-xs">
                          = ${fmt2(tool2Animator.onsiteHourRatePkr / constants.fxRate)}/hr USD
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ No hourly rate on this profile. Set onsiteHourRatePkr in Users → Edit.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tool 2 Result */}
          {tool2Result && tool2Animator && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b bg-muted/40 flex items-center justify-between">
                <div>
                  <span className="font-semibold">{tool2Animator.fullName}</span>
                  <span className="text-sm text-muted-foreground ml-2">@{tool2Animator.username}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  ${fmt2(projectPrice)} project · {constants.productionMultiple}× multiple
                </div>
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* PRIMARY OUTPUTS */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-foreground text-background px-5 py-4">
                    <div className="text-xs opacity-70 uppercase tracking-wide font-medium">Allowed Hours</div>
                    <div className="text-3xl font-bold mt-1">{fmt2(tool2Result.allowedHours)}h</div>
                    <div className="text-xs opacity-60 mt-0.5">
                      {fmtHours(tool2Result.allowedHours)} — enter into the project
                    </div>
                  </div>
                  <div className="rounded-xl bg-foreground text-background px-5 py-4">
                    <div className="text-xs opacity-70 uppercase tracking-wide font-medium">Points to Award</div>
                    <div className="text-3xl font-bold mt-1">{fmt2(tool2Result.pointsToAward)}</div>
                    <div className="text-xs opacity-60 mt-0.5">
                      ≈ {Math.round(tool2Result.pointsToAward)} pts — same regardless of animator
                    </div>
                  </div>
                </div>

                {/* PROFIT SUMMARY */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Project Revenue</div>
                    <div className="font-semibold mt-0.5">${fmt2(projectPrice)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Labour Cost</div>
                    <div className="font-semibold mt-0.5">${fmt2(tool2Result.costToCompany)}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmt2(tool2Result.allowedHours)}h × ${fmt2(tool2Result.hourlyUSD)}/hr
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Implied Profit</div>
                    <div className="font-semibold mt-0.5">${fmt2(tool2Result.impliedProfit)}</div>
                    <div className="text-xs text-muted-foreground">
                      {pct(tool2Result.impliedProfit, projectPrice)} margin
                    </div>
                  </div>
                </div>

                {/* FULL BREAKDOWN */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Calculation Breakdown
                  </div>
                  <div className="space-y-2">
                    <BreakdownRow
                      label="Hourly rate (USD)"
                      formula={`${fmtPKR(tool2Animator.onsiteHourRatePkr!)} ÷ ${constants.fxRate} PKR/$`}
                      value={`$${fmt2(tool2Result.hourlyUSD)}/hr`}
                    />
                    <BreakdownRow
                      label={`Effective hourly target (${constants.productionMultiple}× multiple)`}
                      formula={`$${fmt2(tool2Result.hourlyUSD)} × ${constants.productionMultiple}`}
                      value={`$${fmt2(tool2Result.hourlyUSD * constants.productionMultiple)}/hr`}
                    />
                    <div className="border-t pt-2 mt-2">
                      <BreakdownRow
                        label="Allowed hours"
                        formula={`$${fmt2(projectPrice)} ÷ $${fmt2(tool2Result.hourlyUSD * constants.productionMultiple)}/hr`}
                        value={`${fmt2(tool2Result.allowedHours)}h`}
                        highlight
                      />
                      <BreakdownRow
                        label="Points to award"
                        formula={`$${fmt2(projectPrice)} ÷ $${constants.dollarsPerPoint}/pt`}
                        value={`${fmt2(tool2Result.pointsToAward)} pts`}
                        highlight
                      />
                    </div>
                  </div>
                </div>

                {/* SANITY NOTE — explains the "same points, different hours" rule */}
                <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Why different hours for different animators?</span>{" "}
                  Points are price-driven — a ${fmt2(projectPrice)} project always earns{" "}
                  <span className="font-medium text-foreground">{fmt2(tool2Result.pointsToAward)} pts</span>,
                  no matter who does it. But allowed hours are salary-driven — a cheaper animator
                  gets more time because each of their hours costs the company less. Both hit 100%
                  of their monthly target if they keep this pace all month. ✅
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!tool2Result && (
            <div className="rounded-xl border border-dashed bg-muted/30 px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Select an animator and enter a project price to see results.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                No video duration needed — price alone drives everything for animators.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BREAKDOWN ROW — shared UI component for the calculation chain display
// ---------------------------------------------------------------------------
function BreakdownRow({
  label,
  formula,
  value,
  highlight = false,
}: {
  label: string;
  formula: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 rounded px-3 py-2 ${highlight ? "bg-muted" : ""}`}>
      <span className={`text-xs ${highlight ? "font-semibold" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span className="text-xs text-muted-foreground shrink-0">{formula}</span>
      <span className={`text-sm font-medium shrink-0 ${highlight ? "text-foreground" : ""}`}>
        {value}
      </span>
    </div>
  );
}