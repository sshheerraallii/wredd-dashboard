// prisma/seed.ts
import "dotenv/config";
import { PrismaClient, ProjectClass, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function main() {
  // ── 1) Departments ───────────────────────────────────────────────────────
  const departmentNames = ["Video Editing", "Animations", "Web Development", "Operations"];

  const departments = await Promise.all(
    departmentNames.map((name) =>
      prisma.department.upsert({
        where: { slug: slugify(name) },
        update: { name },
        create: { name, slug: slugify(name) },
      })
    )
  );

  const deptIdBySlug = new Map(departments.map((d) => [d.slug, d.id]));

  async function assignDepartments(userId: string, deptSlugs: string[]) {
    await Promise.all(
      deptSlugs.map((slug) => {
        const departmentId = deptIdBySlug.get(slug);
        if (!departmentId) return Promise.resolve();
        return prisma.userDepartment.upsert({
          where: { userId_departmentId: { userId, departmentId } },
          update: {},
          create: { userId, departmentId },
        });
      })
    );
  }

  // ── 2) Project class definitions ─────────────────────────────────────────
  const classPoints: Record<ProjectClass, number> = {
    C: 5,
    C_PLUS: 7,
    B: 9,
    B_PLUS: 12,
    A: 17,
    S: 24,
    S_PLUS: 60,
  };

  await Promise.all(
    (Object.keys(classPoints) as ProjectClass[]).map((cls) =>
      prisma.projectClassDefinition.upsert({
        where: { class: cls },
        update: { basePoints: classPoints[cls] },
        create: { class: cls, basePoints: classPoints[cls] },
      })
    )
  );

  // ── 3) Super Admin ────────────────────────────────────────────────────────
  const passwordPlain = "NewStrongPassword123!";
  const passwordHash = await bcrypt.hash(passwordPlain, 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: "sshheerraallii@gmail.com" },
    update: {
      fullName: "Sher Ali",
      username: "sher",
      role: Role.SUPER_ADMIN,
      passwordHash,
      archivedAt: null,
      workerType: null,
    },
    create: {
      fullName: "Sher Ali",
      username: "sher",
      email: "sshheerraallii@gmail.com",
      role: Role.SUPER_ADMIN,
      passwordHash,
      workerType: null,
    },
  });

  // Give super admin access to all departments
  await assignDepartments(superAdmin.id, departments.map((d) => d.slug));

  console.log("✅ Seed complete.");
  console.log("─────────────────────────────────────────");
  console.log("Super Admin login:");
  console.log("  Email   :", "sshheerraallii@gmail.com");
  console.log("  Username:", "sher");
  console.log("  Password:", passwordPlain);
  console.log("─────────────────────────────────────────");
  console.log("⚠️  Change your password after first login!");
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