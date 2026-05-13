// prisma/seed.ts
import "dotenv/config";
import { PrismaClient, ProjectClass, Role, WorkerType } from "@prisma/client";
import bcrypt from "bcryptjs";

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma v7 + prisma.config.ts: use an adapter (direct DB connection)
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

type SeededLogin = {
  role: Role;
  workerType?: WorkerType | null;
  fullName: string;
  username: string;
  email: string;
  password: string;
};

async function main() {
  // Shared password for ALL seeded users
  const passwordPlain = "NewStrongPassword123!";
  const passwordHash = await bcrypt.hash(passwordPlain, 12);

  // 1) Departments
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

  // 2) Project class definitions (base points)
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

  const logins: SeededLogin[] = [];

  // 3) Super Admin (Sher Ali)
  const superEmail = "sher@wredd.com";
  const superUsername = "sher";
  const superName = "Sher Ali";

  const superAdmin = await prisma.user.upsert({
    where: { email: superEmail },
    update: {
      fullName: superName,
      username: superUsername,
      role: Role.SUPER_ADMIN,
      passwordHash,
      archivedAt: null,
      workerType: null,
    },
    create: {
      fullName: superName,
      username: superUsername,
      email: superEmail,
      role: Role.SUPER_ADMIN,
      passwordHash,
      workerType: null,
    },
  });

  // Give super admin access to all departments
  await assignDepartments(superAdmin.id, departments.map((d) => d.slug));

  logins.push({
    role: Role.SUPER_ADMIN,
    workerType: null,
    fullName: superName,
    username: superUsername,
    email: superEmail,
    password: passwordPlain,
  });

  // 4) Users for each role
  // Note: Choose defaults that make sense with your WorkerType enum
  const usersToSeed: Array<{
    role: Role;
    fullName: string;
    username: string;
    email: string;
    workerType?: WorkerType | null;
    departmentSlugs: string[];
  }> = [
    {
      role: Role.MANAGER,
      fullName: "Wredd Manager",
      username: "manager",
      email: "manager@wredd.com",
      workerType: WorkerType.OPERATIONS,
      departmentSlugs: ["operations"],
    },
    {
      role: Role.BUSINESS_DEVELOPER,
      fullName: "Wredd BD",
      username: "bd",
      email: "bd@wredd.com",
      workerType: WorkerType.OPERATIONS,
      departmentSlugs: ["operations"],
    },
    {
      role: Role.REMOTE_WORKER,
      fullName: "Remote Video Editor",
      username: "remote",
      email: "remote@wredd.com",
      workerType: WorkerType.REMOTE_VIDEO_EDITOR,
      departmentSlugs: ["video-editing"],
    },
    {
      role: Role.ONSITE_EMPLOYEE,
      fullName: "Onsite Video Editor",
      username: "onsite",
      email: "onsite@wredd.com",
      workerType: WorkerType.ONSITE_VIDEO_EDITOR,
      departmentSlugs: ["video-editing"],
    },
  ];

  for (const u of usersToSeed) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        username: u.username,
        role: u.role,
        workerType: u.workerType ?? null,
        passwordHash,
        archivedAt: null,
      },
      create: {
        fullName: u.fullName,
        username: u.username,
        email: u.email,
        role: u.role,
        workerType: u.workerType ?? null,
        passwordHash,
      },
    });

    await assignDepartments(user.id, u.departmentSlugs);

    logins.push({
      role: u.role,
      workerType: u.workerType ?? null,
      fullName: u.fullName,
      username: u.username,
      email: u.email,
      password: passwordPlain,
    });
  }

  console.log("Seed complete.");
  console.log("Login list (keep):");
  console.table(
    logins.map((x) => ({
      role: x.role,
      workerType: x.workerType ?? "",
      email: x.email,
      username: x.username,
      password: x.password,
    }))
  );
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
