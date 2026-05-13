// prisma/seed-faker.ts
import "dotenv/config";

import {
  PrismaClient,
  Role,
  WorkerType,
  ProjectStatus,
  MessageType,
  PaymentLineStatus,
  ProjectClass,
} from "@prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { faker } from "@faker-js/faker";

/**
 * =========================
 * PRISMA 7 (adapter-pg)
 * =========================
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * =========================
 * SAFETY
 * =========================
 */
function mustBeDev() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("❌ Faker seed blocked in production");
  }
}

/**
 * =========================
 * HELPERS
 * =========================
 */
function randomDateLast18Months() {
  const now = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 18);
  return new Date(
    faker.number.int({ min: start.getTime(), max: now.getTime() })
  );
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function payableOn(firstCompletedAt: Date) {
  return new Date(
    Date.UTC(
      firstCompletedAt.getUTCFullYear(),
      firstCompletedAt.getUTCMonth() + 1,
      10
    )
  );
}

function pickStatus(i: number): ProjectStatus {
  if (i < 15) return "UNASSIGNED";
  if (i < 35) return "IN_PROGRESS";
  if (i < 50) return "DELIVERED";
  if (i < 65) return "REVISION";
  if (i < 95) return "COMPLETED";
  return "CANCELLED";
}

/**
 * =========================
 * MAIN
 * =========================
 */
async function main() {
  mustBeDev();

  const seedTag = faker.string.alphanumeric(8).toLowerCase();
  console.log("FAKER SEED TAG:", seedTag);

  const passwordHash = "$2b$10$FAKER.FAKER.FAKER.FAKER";

  /**
   * Departments (already exist)
   */
  const videoDept = await prisma.department.findFirstOrThrow({
    where: { name: { contains: "Video", mode: "insensitive" } },
  });

  const animDept = await prisma.department.findFirstOrThrow({
    where: { name: { contains: "Anim", mode: "insensitive" } },
  });

  /**
   * Project class definitions
   */
  const classDefs = await prisma.projectClassDefinition.findMany();

  /**
   * Admin / Manager / BD
   */
  const sa =
    (await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } })) ??
    (await prisma.user.create({
      data: {
        fullName: "Faker Super Admin",
        username: `faker_sa_${seedTag}`,
        email: `faker_sa_${seedTag}@wredd.local`,
        passwordHash,
        role: "SUPER_ADMIN",
      },
    }));

  const managers = await Promise.all(
    Array.from({ length: 2 }).map((_, i) =>
      prisma.user.create({
        data: {
          fullName: faker.person.fullName(),
          username: `faker_mgr_${seedTag}_${i}`,
          email: `faker_mgr_${seedTag}_${i}@wredd.local`,
          passwordHash,
          role: "MANAGER",
        },
      })
    )
  );

  const bds = await Promise.all(
    Array.from({ length: 4 }).map((_, i) =>
      prisma.user.create({
        data: {
          fullName: faker.person.fullName(),
          username: `faker_bd_${seedTag}_${i}`,
          email: `faker_bd_${seedTag}_${i}@wredd.local`,
          passwordHash,
          role: "BUSINESS_DEVELOPER",
        },
      })
    )
  );

  /**
   * Workers (60 total)
   */
  async function createWorkers(
    count: number,
    role: Role,
    workerType: WorkerType,
    deptId: string,
    prefix: string
  ) {
    return Promise.all(
      Array.from({ length: count }).map((_, i) =>
        prisma.user.create({
          data: {
            fullName: faker.person.fullName(),
            username: `faker_${prefix}_${seedTag}_${i}`,
            email: `faker_${prefix}_${seedTag}_${i}@wredd.local`,
            passwordHash,
            role,
            workerType,
            targetMonthlyPoints:
              role === "ONSITE_EMPLOYEE"
                ? faker.number.int({ min: 150, max: 450 })
                : 0,
            joinedAt: randomDateLast18Months(),
            departments: { create: [{ departmentId: deptId }] },
          },
        })
      )
    );
  }

  const remoteVideo = await createWorkers(
    15,
    "REMOTE_WORKER",
    "REMOTE_VIDEO_EDITOR",
    videoDept.id,
    "rve"
  );

  const onsiteVideo = await createWorkers(
    15,
    "ONSITE_EMPLOYEE",
    "ONSITE_VIDEO_EDITOR",
    videoDept.id,
    "ove"
  );

  const remoteAnim = await createWorkers(
    15,
    "REMOTE_WORKER",
    "REMOTE_ANIMATOR",
    animDept.id,
    "ran"
  );

  const onsiteAnim = await createWorkers(
    15,
    "ONSITE_EMPLOYEE",
    "ONSITE_ANIMATOR",
    animDept.id,
    "oan"
  );

  const remoteWorkers = [...remoteVideo, ...remoteAnim];
  const onsiteWorkers = [...onsiteVideo, ...onsiteAnim];

  /**
   * 100 Projects
   */
  for (let i = 0; i < 100; i++) {
    const status = pickStatus(i);
    const createdAt = randomDateLast18Months();
    const isRemote = i % 2 === 0;
    const dept = isRemote ? videoDept : animDept;
    const createdBy = faker.helpers.arrayElement(bds);

    const firstCompletedAt =
      status === "COMPLETED"
        ? faker.date.between({ from: createdAt, to: new Date() })
        : null;

    const project = await prisma.project.create({
      data: {
        title: `[FAKER:${seedTag}] Project ${i + 1}`,
        description: faker.lorem.sentence(),
        departmentId: dept.id,
        status,
        deadlineHours: faker.number.int({ min: 12, max: 96 }),
        createdById: createdBy.id,
        createdAt,
        firstCompletedAt,
        remotePrice: isRemote
          ? String(faker.number.int({ min: 3000, max: 10000 }))
          : null,
        onsitePointsManual: !isRemote
          ? faker.number.int({ min: 5, max: 15 })
          : null,
        projectClassDefinitionId: !isRemote
          ? faker.helpers.arrayElement(classDefs).id
          : null,
      },
    });

    /**
     * Assignment
     */
    if (status !== "UNASSIGNED") {
      const worker = isRemote
        ? faker.helpers.arrayElement(remoteWorkers)
        : faker.helpers.arrayElement(onsiteWorkers);

      await prisma.projectAssignment.create({
        data: {
          projectId: project.id,
          userId: worker.id,
          assignedById: faker.helpers.arrayElement([
            sa.id,
            ...managers.map((m) => m.id),
            ...bds.map((b) => b.id),
          ]),
        },
      });

      /**
       * COMPLETED logic
       */
      if (status === "COMPLETED" && firstCompletedAt) {
        if (isRemote) {
          await prisma.projectPaymentLine.create({
            data: {
              projectId: project.id,
              userId: worker.id,
              amount: String(faker.number.int({ min: 3000, max: 10000 })),
              status: faker.helpers.arrayElement([
                "UNPAID",
                "PAID",
                "EXCEPTION_PAID",
              ]),
              payableOn: payableOn(firstCompletedAt),
            },
          });
        } else {
          await prisma.onsitePointCredit.create({
            data: {
              projectId: project.id,
              userId: worker.id,
              points: faker.number.int({ min: 5, max: 15 }),
              setById: sa.id,
              monthKey: monthKey(firstCompletedAt),
            },
          });
        }
      }
    }
  }

  console.log("✅ Faker seed completed successfully");
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
