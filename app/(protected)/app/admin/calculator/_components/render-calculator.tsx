"use client";

// =============================================================================
// FILE: app/(protected)/app/admin/calculator/_components/render-calculator.tsx
//
// PURPOSE: Interactive render calculator. Pure client-side, zero DB writes.
//          All state lives in React state + localStorage for constant persistence.
//
// FORMULA CHAIN (all in one place for easy future edits):
//   y1  = targetMonthlyPoints / workingDays          → daily point target
//   y2  = y1 × dollarsPerPoint                       → daily $ budget
//   x   = perMinuteRate  (entered or derived)        → project value per minute
//   a   = y2 / x                                     → mins of video per day
//   b   = a / effectiveHoursPerDay                   → mins of video per hour (throughput)
//   z   = workerDurationMins / b                     → ALLOWED HOURS  ← main output
//   pts = (workerDurationMins × x) / dollarsPerPoint → POINTS TO AWARD ← main output
//
// CONSTANTS (user-adjustable, persisted to localStorage):
//   workingDays       = 25    (working days per month)
//   effectiveHoursDay = 6.5   (productive hours per work day — not 8, real render hours)
//   dollarsPerPoint   = 6     (1 point = $6, set by salary/overhead calibration)
//
// TO CHANGE A CONSTANT PERMANENTLY: update DEFAULT_CONSTANTS below.
// =============================================================================

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

type Worker = {
  id: string;
  fullName: string;
  username: string;
  targetMonthlyPoints: number;
  workerType: string | null;
};

type InputMode = "per_minute" | "total_price"; // how the project rate is entered

type WorkerSlot = {
  workerId: string;       // selected worker ID ("" = none selected)
  durationMins: string;   // this worker's assigned portion of the video (minutes)
};

type Constants = {
  workingDays: number;
  effectiveHoursPerDay: number;
  dollarsPerPoint: number;
};

// ---------------------------------------------------------------------------
// DEFAULT CONSTANTS — change these if the business rules change permanently
// ---------------------------------------------------------------------------
const DEFAULT_CONSTANTS: Constants = {
  workingDays: 25,
  effectiveHoursPerDay: 6.5,
  dollarsPerPoint: 6,
};

const STORAGE_KEY = "wredd:calc:constants"; // localStorage key

// ---------------------------------------------------------------------------
// CALCULATION ENGINE
// All maths in one pure function — easy to test, easy to audit.
// ---------------------------------------------------------------------------
type CalcResult = {
  y1: number;     // daily point target
  y2: number;     // daily $ budget
  a: number;      // mins of video per day
  b: number;      // mins of video per hour (throughput)
  z: number;      // allowed hours (main output)
  points: number; // points to award (main output)
};

function runCalc(params: {
  targetMonthlyPoints: number;
  workingDays: number;
  effectiveHoursPerDay: number;
  dollarsPerPoint: number;
  perMinuteRate: number;
  workerDurationMins: number;
}): CalcResult | null {
  const {
    targetMonthlyPoints,
    workingDays,
    effectiveHoursPerDay,
    dollarsPerPoint,
    perMinuteRate,
    workerDurationMins,
  } = params;

  // Guard: all inputs must be positive numbers
  if (
    !targetMonthlyPoints ||
    !workingDays ||
    !effectiveHoursPerDay ||
    !dollarsPerPoint ||
    !perMinuteRate ||
    !workerDurationMins ||
    perMinuteRate <= 0 ||
    workerDurationMins <= 0
  ) {
    return null;
  }

  const y1 = targetMonthlyPoints / workingDays;
  const y2 = y1 * dollarsPerPoint;
  const a = y2 / perMinuteRate;
  const b = a / effectiveHoursPerDay;
  const z = workerDurationMins / b;
  const points = (workerDurationMins * perMinuteRate) / dollarsPerPoint;

  return { y1, y2, a, b, z, points };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function fmt2(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function fmtHours(n: number) {
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function workerTypeLabel(wt: string | null) {
  if (!wt) return "";
  return wt
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

export function RenderCalculator({ workers }: { workers: Worker[] }) {
  // --- Constants state (persisted to localStorage) ---
  const [constants, setConstants] = useState<Constants>(DEFAULT_CONSTANTS);
  const [constantsOpen, setConstantsOpen] = useState(false);

  // Load saved constants from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Constants>;
        setConstants((prev) => ({
          workingDays: parsed.workingDays ?? prev.workingDays,
          effectiveHoursPerDay: parsed.effectiveHoursPerDay ?? prev.effectiveHoursPerDay,
          dollarsPerPoint: parsed.dollarsPerPoint ?? prev.dollarsPerPoint,
        }));
      }
    } catch {
      // If localStorage is unavailable or corrupted, silently use defaults
    }
  }, []);

  // Save constants to localStorage whenever they change
  const updateConstants = useCallback((patch: Partial<Constants>) => {
    setConstants((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const resetConstants = () => {
    setConstants(DEFAULT_CONSTANTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  // --- Project rate inputs ---
  const [inputMode, setInputMode] = useState<InputMode>("per_minute");
  const [perMinuteRateStr, setPerMinuteRateStr] = useState("");
  const [totalPriceStr, setTotalPriceStr] = useState("");
  const [totalDurationStr, setTotalDurationStr] = useState("");

  // Derive the effective per-minute rate from whichever mode is active
  const effectiveRate = (() => {
    if (inputMode === "per_minute") {
      const n = parseFloat(perMinuteRateStr);
      return Number.isFinite(n) && n > 0 ? n : null;
    } else {
      const price = parseFloat(totalPriceStr);
      const dur = parseFloat(totalDurationStr);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(dur) && dur > 0) {
        return price / dur;
      }
      return null;
    }
  })();

  // --- Worker slots (1 required, 1 optional) ---
  const [workerSlots, setWorkerSlots] = useState<WorkerSlot[]>([
    { workerId: "", durationMins: "" },
  ]);

  const addWorker = () => {
    if (workerSlots.length < 2) {
      setWorkerSlots((prev) => [...prev, { workerId: "", durationMins: "" }]);
    }
  };

  const removeWorker = (idx: number) => {
    setWorkerSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, patch: Partial<WorkerSlot>) => {
    setWorkerSlots((prev) =>
      prev.map((slot, i) => (i === idx ? { ...slot, ...patch } : slot))
    );
  };

  // --- Compute results for each worker slot ---
  const results = workerSlots.map((slot) => {
    const worker = workers.find((w) => w.id === slot.workerId) ?? null;
    const durationMins = parseFloat(slot.durationMins);

    if (!worker || !effectiveRate || !Number.isFinite(durationMins) || durationMins <= 0) {
      return null;
    }

    return runCalc({
      targetMonthlyPoints: worker.targetMonthlyPoints,
      workingDays: constants.workingDays,
      effectiveHoursPerDay: constants.effectiveHoursPerDay,
      dollarsPerPoint: constants.dollarsPerPoint,
      perMinuteRate: effectiveRate,
      workerDurationMins: durationMins,
    });
  });

  const anyResult = results.some((r) => r !== null);

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">

      {/* ================================================================
          SECTION 1: CONSTANTS
          Collapsible panel. Values persist to localStorage.
          Changes here affect ALL calculations instantly.
      ================================================================ */}
      <div className="rounded-xl border bg-card">
        {/* Header — click to expand/collapse */}
        <button
          type="button"
          onClick={() => setConstantsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
        >
          <div>
            <span className="font-medium text-sm">⚙️ Calculator Settings</span>
            <span className="ml-3 text-xs text-muted-foreground">
              {constants.workingDays} days · {constants.effectiveHoursPerDay}h/day · ${constants.dollarsPerPoint}/pt
            </span>
          </div>
          <span className="text-muted-foreground text-xs">
            {constantsOpen ? "▲ collapse" : "▼ edit"}
          </span>
        </button>

        {constantsOpen && (
          <div className="border-t px-5 py-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              These values are saved in your browser and remembered next time.
              Change them only if business rules change — they affect every calculation.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Working days per month */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Working Days / Month
                </span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  value={constants.workingDays}
                  onChange={(e) =>
                    updateConstants({ workingDays: parseFloat(e.target.value) || DEFAULT_CONSTANTS.workingDays })
                  }
                  className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
                <span className="text-xs text-muted-foreground">Default: 25</span>
              </label>

              {/* Effective working hours per day */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Effective Hours / Day
                </span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  step={0.5}
                  value={constants.effectiveHoursPerDay}
                  onChange={(e) =>
                    updateConstants({ effectiveHoursPerDay: parseFloat(e.target.value) || DEFAULT_CONSTANTS.effectiveHoursPerDay })
                  }
                  className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
                <span className="text-xs text-muted-foreground">Default: 6.5 (real productive hours)</span>
              </label>

              {/* Dollars per point */}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  $ per Point
                </span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={constants.dollarsPerPoint}
                  onChange={(e) =>
                    updateConstants({ dollarsPerPoint: parseFloat(e.target.value) || DEFAULT_CONSTANTS.dollarsPerPoint })
                  }
                  className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
                <span className="text-xs text-muted-foreground">Default: $6 (1 point = $6 value)</span>
              </label>
            </div>

            <button
              type="button"
              onClick={resetConstants}
              className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
            >
              Reset to defaults (25 days · 6.5h · $6/pt)
            </button>
          </div>
        )}
      </div>

      {/* ================================================================
          SECTION 2: PROJECT RATE
          Two modes: enter per-minute rate directly, or derive from
          total price ÷ total video duration.
      ================================================================ */}
      <div className="rounded-xl border bg-card px-5 py-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Step 1 — Project Rate</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            How much is this project worth per minute of video?
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setInputMode("per_minute")}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              inputMode === "per_minute"
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            Per-Minute Rate
          </button>
          <button
            type="button"
            onClick={() => setInputMode("total_price")}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              inputMode === "total_price"
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            Total Price ÷ Duration
          </button>
        </div>

        {/* Inputs depending on mode */}
        {inputMode === "per_minute" ? (
          <label className="block max-w-xs">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Rate per Minute (USD)
            </span>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="e.g. 3.00"
                value={perMinuteRateStr}
                onChange={(e) => setPerMinuteRateStr(e.target.value)}
                className="w-full rounded-lg border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
              />
            </div>
          </label>
        ) : (
          <div className="flex flex-wrap gap-4 items-end">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total Project Price (USD)
              </span>
              <div className="relative mt-1.5">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 150.00"
                  value={totalPriceStr}
                  onChange={(e) => setTotalPriceStr(e.target.value)}
                  className="w-48 rounded-lg border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total Video Duration (mins)
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                placeholder="e.g. 50"
                value={totalDurationStr}
                onChange={(e) => setTotalDurationStr(e.target.value)}
                className="mt-1.5 w-40 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
              />
            </label>

            {/* Live derived rate preview */}
            {effectiveRate !== null && (
              <div className="pb-2">
                <span className="text-xs text-muted-foreground">Derived rate: </span>
                <span className="text-sm font-semibold">${fmt2(effectiveRate)}/min</span>
              </div>
            )}
          </div>
        )}

        {/* Rate confirmation badge */}
        {effectiveRate !== null && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <span className="text-xs text-muted-foreground">Project rate locked at</span>
            <span className="font-semibold text-sm">${fmt2(effectiveRate)} / minute</span>
          </div>
        )}
      </div>

      {/* ================================================================
          SECTION 3: WORKER SLOTS
          Worker 1 always visible. Worker 2 added on demand.
          Each worker selects themselves + enters their duration slice.
      ================================================================ */}
      <div className="rounded-xl border bg-card px-5 py-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-sm">Step 2 — Workers &amp; Duration Split</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter each worker's <em>assigned portion</em> of the video (not the full duration).
              The rate and constants apply to each worker independently.
            </p>
          </div>
          {workerSlots.length < 2 && (
            <button
              type="button"
              onClick={addWorker}
              className="text-xs border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors shrink-0"
            >
              + Add Second Worker
            </button>
          )}
        </div>

        <div className="space-y-4">
          {workerSlots.map((slot, idx) => (
            <WorkerSlotRow
              key={idx}
              index={idx}
              slot={slot}
              workers={workers}
              onUpdate={(patch) => updateSlot(idx, patch)}
              onRemove={idx === 1 ? () => removeWorker(idx) : undefined}
            />
          ))}
        </div>
      </div>

      {/* ================================================================
          SECTION 4: RESULTS
          One result card per worker. Shows full calculation breakdown
          so the manager can understand every number.
      ================================================================ */}
      {anyResult && effectiveRate !== null && (
        <div className="space-y-4">
          <h2 className="font-semibold text-sm px-1">Results</h2>

          {workerSlots.map((slot, idx) => {
            const result = results[idx];
            const worker = workers.find((w) => w.id === slot.workerId) ?? null;
            const durationMins = parseFloat(slot.durationMins);

            if (!result || !worker) return null;

            return (
              <ResultCard
                key={idx}
                workerIndex={idx}
                worker={worker}
                durationMins={durationMins}
                result={result}
                perMinuteRate={effectiveRate}
                constants={constants}
              />
            );
          })}
        </div>
      )}

      {/* Empty state guidance */}
      {!anyResult && (
        <div className="rounded-xl border border-dashed bg-muted/30 px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Complete Steps 1 and 2 to see results here.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            You need: a project rate · a worker selected · a duration entered
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WORKER SLOT ROW COMPONENT
// ---------------------------------------------------------------------------
function WorkerSlotRow({
  index,
  slot,
  workers,
  onUpdate,
  onRemove,
}: {
  index: number;
  slot: WorkerSlot;
  workers: Worker[];
  onUpdate: (patch: Partial<WorkerSlot>) => void;
  onRemove?: () => void;
}) {
  const selectedWorker = workers.find((w) => w.id === slot.workerId) ?? null;

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Worker {index + 1}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        {/* Worker picker */}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Select Worker
          </span>
          <select
            value={slot.workerId}
            onChange={(e) => onUpdate({ workerId: e.target.value })}
            className="mt-1.5 block w-64 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
          >
            <option value="">— Pick a worker —</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.fullName} (@{w.username})
              </option>
            ))}
          </select>
        </label>

        {/* Duration input */}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Assigned Duration (mins)
          </span>
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="e.g. 12"
            value={slot.durationMins}
            onChange={(e) => onUpdate({ durationMins: e.target.value })}
            className="mt-1.5 w-36 block rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-muted-foreground/30"
          />
        </label>

        {/* Worker info badge — auto-populated from selection */}
        {selectedWorker && (
          <div className="pb-2 text-sm">
            <span className="text-muted-foreground text-xs">Monthly target: </span>
            <span className="font-semibold">{selectedWorker.targetMonthlyPoints} pts</span>
            {selectedWorker.workerType && (
              <span className="ml-2 text-xs text-muted-foreground">
                · {workerTypeLabel(selectedWorker.workerType)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RESULT CARD COMPONENT
// Shows full calculation breakdown for one worker.
// ---------------------------------------------------------------------------
function ResultCard({
  workerIndex,
  worker,
  durationMins,
  result,
  perMinuteRate,
  constants,
}: {
  workerIndex: number;
  worker: Worker;
  durationMins: number;
  result: CalcResult;
  perMinuteRate: number;
  constants: Constants;
}) {
  const { y1, y2, a, b, z, points } = result;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b bg-muted/40 flex items-center justify-between">
        <div>
          <span className="font-semibold">{worker.fullName}</span>
          <span className="text-sm text-muted-foreground ml-2">@{worker.username}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {durationMins} min · ${fmt2(perMinuteRate)}/min
        </div>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* === PRIMARY OUTPUTS — what manager needs to enter manually === */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-foreground text-background px-5 py-4">
            <div className="text-xs opacity-70 uppercase tracking-wide font-medium">Allowed Hours</div>
            <div className="text-3xl font-bold mt-1">{fmt2(z)}h</div>
            <div className="text-xs opacity-60 mt-0.5">{fmtHours(z)} — enter this into the project</div>
          </div>
          <div className="rounded-xl bg-foreground text-background px-5 py-4">
            <div className="text-xs opacity-70 uppercase tracking-wide font-medium">Points to Award</div>
            <div className="text-3xl font-bold mt-1">{fmt2(points)}</div>
            <div className="text-xs opacity-60 mt-0.5">
              ≈ {Math.round(points)} pts — enter into performance credits
            </div>
          </div>
        </div>

        {/* === CALCULATION BREAKDOWN — full transparency === */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Calculation Breakdown
          </div>
          <div className="space-y-2">
            <BreakdownRow
              label="Daily point target (y1)"
              formula={`${worker.targetMonthlyPoints} pts ÷ ${constants.workingDays} days`}
              value={`${fmt2(y1)} pts/day`}
            />
            <BreakdownRow
              label="Daily $ budget (y2)"
              formula={`${fmt2(y1)} pts × $${constants.dollarsPerPoint}/pt`}
              value={`$${fmt2(y2)}/day`}
            />
            <BreakdownRow
              label="Video mins per day (a)"
              formula={`$${fmt2(y2)} ÷ $${fmt2(perMinuteRate)}/min`}
              value={`${fmt2(a)} min/day`}
            />
            <BreakdownRow
              label="Throughput (b)"
              formula={`${fmt2(a)} min ÷ ${constants.effectiveHoursPerDay}h`}
              value={`${fmt2(b)} min/hour`}
            />
            <div className="border-t pt-2 mt-2">
              <BreakdownRow
                label="Allowed hours (z)"
                formula={`${durationMins} min ÷ ${fmt2(b)} min/hr`}
                value={`${fmt2(z)}h`}
                highlight
              />
              <BreakdownRow
                label="Points to award"
                formula={`${durationMins} min × $${fmt2(perMinuteRate)} ÷ $${constants.dollarsPerPoint}/pt`}
                value={`${fmt2(points)} pts`}
                highlight
              />
            </div>
          </div>
        </div>

        {/* === MONTH-END SANITY CHECK ===
            If this worker works their full month at this project's rate,
            they will hit exactly 100% of target. This is a built-in proof
            that the formula is internally consistent. */}
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Month-end check:</span>
          {" "}
          If {worker.fullName.split(" ")[0]} works all {constants.workingDays} days at this rate →{" "}
          <span className="font-medium text-foreground">
            {fmt2(a * constants.workingDays)} mins of video delivered
          </span>
          {" = "}
          <span className="font-medium text-foreground">
            {fmt2((a * constants.workingDays * perMinuteRate) / constants.dollarsPerPoint)} pts
          </span>
          {" (target: "}
          {worker.targetMonthlyPoints}
          {" pts) "}
          {Math.abs(
            (a * constants.workingDays * perMinuteRate) / constants.dollarsPerPoint -
              worker.targetMonthlyPoints
          ) < 0.1
            ? "✅ Exact match"
            : "⚠ Check inputs"}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BREAKDOWN ROW — one line of the calculation chain
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
    <div
      className={`flex items-baseline justify-between gap-2 rounded px-3 py-2 ${
        highlight ? "bg-muted" : ""
      }`}
    >
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

// ---------------------------------------------------------------------------
// TYPE re-export so CalcResult is accessible to ResultCard above
// ---------------------------------------------------------------------------
type CalcResult = {
  y1: number;
  y2: number;
  a: number;
  b: number;
  z: number;
  points: number;
};