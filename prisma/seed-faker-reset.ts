// prisma/seed-faker-reset.ts
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function mustBeDev() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("❌ Faker reset blocked in production");
  }
}

async function main() {
  mustBeDev();

  const projects = await prisma.project.findMany({
    where: { title: { startsWith: "[FAKER:" } },
    select: { id: true },
  });

  const projectIds = projects.map((p) => p.id);

  const users = await prisma.user.findMany({
    where: { username: { startsWith: "faker_" } },
    select: { id: true },
  });

  const userIds = users.map((u) => u.id);

  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.projectWatcher.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.projectActivity.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.projectRating.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.onsiteProjectRating.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.projectPaymentLine.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.onsitePointCredit.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.projectAssignment.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.project.deleteMany({ where: { id: { in: projectIds } } });

    await tx.userDepartment.deleteMany({ where: { userId: { in: userIds } } });
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });

  console.log("🧹 Faker data removed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
