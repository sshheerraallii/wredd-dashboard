import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import {
  getOnsiteOverheadSettings,
  overheadForWorkerType,
  sellableHoursPerMonth,
} from "@/lib/onsite-points/overhead-settings";
import { resolveManyUserRatesAsOf } from "@/lib/user-rates/history";

/**
 * Department cost base for a month — ABSORPTION COSTING.
 *
 * A department costs what it costs whether the floor is busy or idle:
 *
 *   department cost = production salaries + that department's share of the pool
 *
 * Salaries are recovered by REVERSING each worker's stored hourly rate, because
 * the rate is (salary / sellableHours) + departmentOverhead. Stripping the
 * overhead back out is what stops it being counted twice — once inside the
 * rate and again as the pool.
 *
 *   salary = (onsiteHourRatePkr - departmentOverhead) x sellableHoursPerMonth
 *
 * Staff set is "active at any point during the month", not "active now", and
 * both salary and capacity are day-weighted by working days survived. A worker
 * who left on the 4th cost real money for those days; the old
 * `archivedAt IS NULL` filter dropped them entirely and charged them to nobody.
 *
 * A worker in N departments splits N ways, salary and capacity alike.
 *
 * The pool is divided between departments by capacity (FTE), not by revenue —
 * a two-person department cannot carry the rent for a nine-person floor.
 */

type Db = Prisma.TransactionClient;

function db(client?: Db): Db {
  return client ?? (getPrisma() as unknown as Db);
}

export type DepartmentCost = {
  departmentId: string;
  name: string;
  fte: number;
  sellableHours: number;
  salariesPkr: number;
  poolSharePct: number;
  poolPkr: number;
  totalPkr: number;
};

export type CostBaseResult = {
  monthKey: string;
  poolPkr: number;
  weekdaysInMonth: number;
  departments: DepartmentCost[];
  totals: {
    fte: number;
    sellableHours: number;
    salariesPkr: number;
    poolPkr: number;
    totalPkr: number;
  };
  /** Active during the month but assigned to no department — cost charged to nobody. */
  orphans: { userId: string; fullName: string; salaryPkr: number }[];
};

export function monthBounds(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1)); // exclusive
  return { start, end };
}

/** Mon–Fri days in [from, to), both UTC. */
export function countWeekdays(from: Date, to: Date): number {
  let n = 0;
  const d = new Date(from.getTime());
  while (d < to) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

export async function computeDepartmentCostBase(
  monthKey: string,
  client?: Db
): Promise<CostBaseResult> {
  const c = db(client);
  const { start, end } = monthBounds(monthKey);

  const [config, overheadSettings] = await Promise.all([
    c.monthlyFinanceConfig.findUnique({
      where: { monthKey },
      select: { overheadPoolPkr: true },
    }),
    getOnsiteOverheadSettings(),
  ]);

  const poolPkr = config?.overheadPoolPkr ?? 0;
  const sellableHours = sellableHoursPerMonth(overheadSettings);
  const weekdaysInMonth = countWeekdays(start, end) || 1;

  // Active at ANY point in the month — leavers included.
  const staff = await c.user.findMany({
    where: {
      role: "ONSITE_EMPLOYEE",
      onsiteHourRatePkr: { not: null },
      joinedAt: { lt: end },
      OR: [{ archivedAt: null }, { archivedAt: { gte: start } }],
    },
    select: {
      id: true,
      fullName: true,
      workerType: true,
      joinedAt: true,
      archivedAt: true,
      departments: {
        select: { departmentId: true, department: { select: { name: true } } },
      },
    },
  });

  // Rates as they stood for THIS month, not as they stand today.
  const rates = await resolveManyUserRatesAsOf(
    staff.map((s) => s.id),
    start,
    c
  );

  const byDept = new Map<
    string,
    { name: string; fte: number; salariesPkr: number }
  >();
  const orphans: CostBaseResult["orphans"] = [];

  for (const s of staff) {
    const rate = rates.get(s.id)?.onsiteHourRatePkr ?? null;
    if (rate == null) continue;

    const overhead = overheadForWorkerType(s.workerType, overheadSettings);
    const monthlySalary = Math.max(0, Math.round((rate - overhead) * sellableHours));

    const from = s.joinedAt > start ? s.joinedAt : start;
    const to = s.archivedAt && s.archivedAt < end ? s.archivedAt : end;
    const worked = to > from ? countWeekdays(from, to) : 0;
    const ratio = Math.min(1, worked / weekdaysInMonth);
    if (ratio <= 0) continue;

    const weightedSalary = monthlySalary * ratio;

    if (s.departments.length === 0) {
      orphans.push({
        userId: s.id,
        fullName: s.fullName,
        salaryPkr: Math.round(weightedSalary),
      });
      continue;
    }

    const n = s.departments.length;
    for (const ud of s.departments) {
      const cur = byDept.get(ud.departmentId) ?? {
        name: ud.department.name,
        fte: 0,
        salariesPkr: 0,
      };
      cur.fte += ratio / n;
      cur.salariesPkr += weightedSalary / n;
      byDept.set(ud.departmentId, cur);
    }
  }

  const totalFte = Array.from(byDept.values()).reduce((a, d) => a + d.fte, 0);

  const departments: DepartmentCost[] = Array.from(byDept.entries())
    .map(([departmentId, d]) => {
      const poolSharePct = totalFte > 0 ? (d.fte / totalFte) * 100 : 0;
      const deptPool = totalFte > 0 ? (poolPkr * d.fte) / totalFte : 0;
      const salaries = Math.round(d.salariesPkr);
      return {
        departmentId,
        name: d.name,
        fte: Number(d.fte.toFixed(4)),
        sellableHours: Number((d.fte * sellableHours).toFixed(2)),
        salariesPkr: salaries,
        poolSharePct: Number(poolSharePct.toFixed(2)),
        poolPkr: Math.round(deptPool),
        totalPkr: salaries + Math.round(deptPool),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    monthKey,
    poolPkr,
    weekdaysInMonth,
    departments,
    totals: {
      fte: Number(totalFte.toFixed(4)),
      sellableHours: Number((totalFte * sellableHours).toFixed(2)),
      salariesPkr: departments.reduce((a, d) => a + d.salariesPkr, 0),
      poolPkr: departments.reduce((a, d) => a + d.poolPkr, 0),
      totalPkr: departments.reduce((a, d) => a + d.totalPkr, 0),
    },
    orphans,
  };
}

/**
 * Blended cost of one hour of studio time, at FULL capacity.
 *
 *   (all department salaries + the whole overhead pool) / all sellable hours
 *
 * This is what an hour genuinely costs when the floor is full, and it is the
 * right rate for judging whether a single project earned more than the time it
 * consumed. It is NOT a commission input — commission is settled monthly.
 */
export function blendedHourCostPkr(costBase: CostBaseResult): number {
  const hours = costBase.totals.sellableHours;
  if (hours <= 0) return 0;
  return Math.round(costBase.totals.totalPkr / hours);
}
