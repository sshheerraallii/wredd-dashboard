// scripts/backfill-user-rate-history.ts
//
// Seeds UserRateHistory with one opening row per user, carrying that user's
// CURRENT onsiteHourRatePkr and targetMonthlyPoints, effective from the day
// they joined.
//
// Run ONCE, right after `prisma db push` adds the table, and BEFORE editing any
// rate. It freezes today's values as the historical truth, so closed months
// keep the numbers they were actually calculated with. Any rate changed
// afterwards writes a NEW row from its own effective date and leaves history
// alone.
//
// Safe to re-run: skips any user who already has history.
//
//   npx tsx scripts/backfill-user-rate-history.ts

import dotenv from "dotenv";

// Load .env then .env.local (local overrides) — same order as seed-system-bd.
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import { getPrisma } from "../lib/prisma";

const prisma = getPrisma();

function utcMidnight(d: Date) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

async function main() {
  console.log("Backfill UserRateHistory: starting...");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      role: true,
      joinedAt: true,
      createdAt: true,
      onsiteHourRatePkr: true,
      targetMonthlyPoints: true,
      _count: { select: { rateHistory: true } },
    },
    orderBy: { fullName: "asc" },
  });

  let created = 0;
  let skipped = 0;

  for (const u of users) {
    if (u._count.rateHistory > 0) {
      skipped++;
      continue;
    }

    // Earliest of joinedAt / createdAt, so no completed project can fall before
    // the opening row and hit the User fallback.
    const base =
      u.joinedAt && u.joinedAt < u.createdAt ? u.joinedAt : u.createdAt;
    const effectiveFrom = utcMidnight(new Date(base));

    await prisma.userRateHistory.create({
      data: {
        userId: u.id,
        effectiveFrom,
        onsiteHourRatePkr: u.onsiteHourRatePkr ?? null,
        targetMonthlyPoints: u.targetMonthlyPoints ?? 0,
        note: "Opening balance — backfilled from current User values",
      },
    });

    created++;
    console.log(
      `  + ${u.fullName} (${u.role}) from ${effectiveFrom
        .toISOString()
        .slice(0, 10)} — rate ${u.onsiteHourRatePkr ?? "null"}, target ${
        u.targetMonthlyPoints ?? 0
      }`
    );
  }

  console.log(
    `Backfill UserRateHistory: done. ${created} created, ${skipped} already had history.`
  );

  const total = await prisma.userRateHistory.count();
  console.log(`UserRateHistory now holds ${total} row(s).`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
