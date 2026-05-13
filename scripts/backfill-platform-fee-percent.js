// scripts/backfill-platform-fee-percent.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Backfill: starting...");

  // 1) BdCommission
  const r1 = await prisma.$executeRawUnsafe(`
    UPDATE "BdCommission"
    SET "platformFeePercent" = ROUND(("platformFeeUsd" / NULLIF("priceUsd", 0)) * 100, 2)
    WHERE "platformFeePercent" IS NULL
  `);

  const r2 = await prisma.$executeRawUnsafe(`
    UPDATE "BdCommission"
    SET "platformFeePercent" = 0
    WHERE "platformFeePercent" IS NULL
  `);

  // 2) ProjectFinance
  const r3 = await prisma.$executeRawUnsafe(`
    UPDATE "ProjectFinance"
    SET "platformFeePercent" = ROUND(("platformFeeUsd" / NULLIF("priceUsd", 0)) * 100, 2)
    WHERE "platformFeePercent" IS NULL
      AND "platformFeeUsd" IS NOT NULL
  `);

  const r4 = await prisma.$executeRawUnsafe(`
    UPDATE "ProjectFinance"
    SET "platformFeePercent" = 0
    WHERE "platformFeePercent" IS NULL
  `);

  console.log("BdCommission updated rows:", r1, "then forced zeros:", r2);
  console.log("ProjectFinance updated rows:", r3, "then forced zeros:", r4);

  const [bcNull] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM "BdCommission"
    WHERE "platformFeePercent" IS NULL
  `);

  const [pfNull] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM "ProjectFinance"
    WHERE "platformFeePercent" IS NULL
  `);

  console.log("Remaining NULLs => BdCommission:", bcNull.n, "ProjectFinance:", pfNull.n);

  // Optional: show a few samples
  const samples = await prisma.$queryRawUnsafe(`
    SELECT "id", "priceUsd", "platformFeeUsd", "platformFeePercent"
    FROM "BdCommission"
    ORDER BY "updatedAt" DESC
    LIMIT 5
  `);
  console.log("Sample BdCommission rows:", samples);

  console.log("Backfill: done.");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });