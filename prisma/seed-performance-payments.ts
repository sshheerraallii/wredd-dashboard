/* prisma/seed-performance-payments.ts */
import { Role, WorkerType, ProjectStatus, PaymentLineStatus, ProjectClass } from "@prisma/client";
import { getPrisma } from "../lib/prisma";
import "dotenv/config";
import bcrypt from "bcryptjs";
const prisma = getPrisma();

/**
 * Fixed "now" for deterministic seeding relative to your current date.
 * Asia/Karachi is fine; we keep it simple with UTC dates but pinned.
 */
const NOW = new Date("2026-02-14T12:00:00.000Z"); // Feb 14, 2026

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function monthKeyFromDate(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${pad2(m)}`;
}

function addMonthsUTC(d: Date, months: number) {
  const nd = new Date(d.getTime());
  const y = nd.getUTCFullYear();
  const m = nd.getUTCMonth();
  const day = nd.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1, 12, 0, 0));
  // Keep day within month range
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12, 0, 0));
}
function endOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12, 0, 0));
}

function hashStringToInt(str: string) {
  // deterministic small hash
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickCount8to10(key: string) {
  const h = hashStringToInt(key);
  return 8 + (h % 3); // 8..10
}

function pickIntInRange(key: string, min: number, max: number) {
  const h = hashStringToInt(key);
  const span = max - min + 1;
  return min + (h % span);
}

function pickFrom<T>(key: string, arr: T[]) {
  const h = hashStringToInt(key);
  return arr[h % arr.length];
}

function randomDayInMonth(key: string, monthStart: Date) {
  const monthEnd = endOfMonthUTC(monthStart);
  const days = monthEnd.getUTCDate();
  const day = pickIntInRange(key, 1, days);
  // midday UTC avoids DST edge cases
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 12, 0, 0));
}

function payableOnForCompletion(completedAt: Date) {
  // 10th of next month
  const nextMonth = addMonthsUTC(startOfMonthUTC(completedAt), 1);
  return new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 10, 12, 0, 0));
}

function isSameMonthUTC(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

async function requireSuperAdminId() {
  const admin = await prisma.user.findFirst({ where: { role: Role.SUPER_ADMIN } });
  if (!admin) {
    throw new Error(
      `No SUPER_ADMIN user found. Seed requires an existing SUPER_ADMIN (from your base seed).`
    );
  }
  return admin.id;
}

async function requireDepartments() {
  const depts = await prisma.department.findMany({ select: { id: true, name: true, slug: true } });

  const findByExactName = (name: string) => depts.find((d) => d.name === name);
  const findByExactSlug = (slug: string) => depts.find((d) => d.slug === slug);

  const animations =
    findByExactName("Animations") ||
    findByExactSlug("animations");

  const videoEditing =
    findByExactName("Video Editing") ||
    findByExactSlug("video-editing");

  if (!animations || !videoEditing) {
    const available = depts.map((d) => `${d.name} (${d.slug})`).join(", ");
    throw new Error(
      `Required departments not found.\n` +
      `Need: Animations + Video Editing (by exact name or slug).\n` +
      `Available: ${available}`
    );
  }

  return { animations, videoEditing };
}

async function ensureWorkers(adminId: string, deptIds: { animationsId: string; videoId: string }) {
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const workers = [
    // Onsite Animators
    { username: "onsite_anim_1", fullName: "Onsite Animator One", email: "onsite_anim_1@seed.wredd", role: Role.ONSITE_EMPLOYEE, workerType: WorkerType.ONSITE_ANIMATOR, target: 120, deptId: deptIds.animationsId },
    { username: "onsite_anim_2", fullName: "Onsite Animator Two", email: "onsite_anim_2@seed.wredd", role: Role.ONSITE_EMPLOYEE, workerType: WorkerType.ONSITE_ANIMATOR, target: 140, deptId: deptIds.animationsId },

    // Onsite Video Editors
    { username: "onsite_vid_1", fullName: "Onsite Video Editor One", email: "onsite_vid_1@seed.wredd", role: Role.ONSITE_EMPLOYEE, workerType: WorkerType.ONSITE_VIDEO_EDITOR, target: 110, deptId: deptIds.videoId },
    { username: "onsite_vid_2", fullName: "Onsite Video Editor Two", email: "onsite_vid_2@seed.wredd", role: Role.ONSITE_EMPLOYEE, workerType: WorkerType.ONSITE_VIDEO_EDITOR, target: 150, deptId: deptIds.videoId },

    // Remote Video Editors
    { username: "remote_vid_1", fullName: "Remote Video Editor One", email: "remote_vid_1@seed.wredd", role: Role.REMOTE_WORKER, workerType: WorkerType.REMOTE_VIDEO_EDITOR, target: 0, deptId: deptIds.videoId },
    { username: "remote_vid_2", fullName: "Remote Video Editor Two", email: "remote_vid_2@seed.wredd", role: Role.REMOTE_WORKER, workerType: WorkerType.REMOTE_VIDEO_EDITOR, target: 0, deptId: deptIds.videoId },

    // Remote Animators
    { username: "remote_anim_1", fullName: "Remote Animator One", email: "remote_anim_1@seed.wredd", role: Role.REMOTE_WORKER, workerType: WorkerType.REMOTE_ANIMATOR, target: 0, deptId: deptIds.animationsId },
    { username: "remote_anim_2", fullName: "Remote Animator Two", email: "remote_anim_2@seed.wredd", role: Role.REMOTE_WORKER, workerType: WorkerType.REMOTE_ANIMATOR, target: 0, deptId: deptIds.animationsId },
  ];

  const createdUsers: { id: string; username: string; role: Role; workerType: WorkerType; deptId: string; target: number }[] = [];

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    // joinedAt 6–9 months back, deterministic per user
    const monthsBack = 6 + (hashStringToInt(w.username) % 4); // 6..9
    const joinedAt = addMonthsUTC(NOW, -monthsBack);
    const createdAt = addMonthsUTC(joinedAt, -1);

    const user = await prisma.user.upsert({
      where: { username: w.username },
      update: {
        fullName: w.fullName,
        email: w.email,
        role: w.role,
        workerType: w.workerType,
        targetMonthlyPoints: w.target,
        passwordHash,
        joinedAt,
      },
      create: {
        fullName: w.fullName,
        username: w.username,
        email: w.email,
        passwordHash,
        role: w.role,
        workerType: w.workerType,
        targetMonthlyPoints: w.target,
        createdAt,
        joinedAt,
      },
      select: { id: true, username: true, role: true, workerType: true },
    });

    // user departments
    await prisma.userDepartment.upsert({
      where: { userId_departmentId: { userId: user.id, departmentId: w.deptId } },
      update: {},
      create: { userId: user.id, departmentId: w.deptId },
    });

    createdUsers.push({ id: user.id, username: user.username, role: user.role, workerType: user.workerType!, deptId: w.deptId, target: w.target });
  }

  return createdUsers;
}

async function getClassDefs() {
  const defs = await prisma.projectClassDefinition.findMany({
    select: { id: true, class: true, basePoints: true },
  });
  // If empty, we still seed fine (we just won’t set classDef ids).
  return defs;
}

function computeOnsitePointsForProject(key: string, monthTier: "low" | "mid" | "high") {
  // Mostly 7–20, sometimes 30
  const roll = hashStringToInt(key) % 100;
  if (roll < 10) return 30; // 10% chance
  const base = pickIntInRange(key, 7, 20);

  // Nudge by tier so monthly totals create 40–120% accuracy spread
  if (monthTier === "low") return Math.max(7, base - 3);
  if (monthTier === "high") return Math.min(30, base + 3);
  return base;
}

function monthTierForUserMonth(userKey: string, monthKey: string): "low" | "mid" | "high" {
  const h = hashStringToInt(`${userKey}::${monthKey}`) % 3;
  return h === 0 ? "low" : h === 1 ? "mid" : "high";
}

function ratingForProject(key: string) {
  // Mixed: more 5s, some 4s, a few 1s
  const roll = hashStringToInt(key) % 100;

  const star =
    roll < 8 ? 1 :
    roll < 18 ? 2 :
    roll < 28 ? 3 :
    roll < 48 ? 4 :
    5;

  // Map to 3 metrics (1..5)
  const comm = Math.max(1, Math.min(5, star + ((hashStringToInt(key + ":c") % 3) - 1)));
  const qual = Math.max(1, Math.min(5, star + ((hashStringToInt(key + ":q") % 3) - 1)));
  const speed = Math.max(1, Math.min(5, star + ((hashStringToInt(key + ":s") % 3) - 1)));

  return { communication: comm, quality: qual, speed };
}

function remoteAmountForProject(key: string) {
  return pickIntInRange(key, 3500, 8000);
}

function manualAdjustmentAmount(key: string) {
  const isFine = (hashStringToInt(key) % 2) === 0;
  if (isFine) return -pickIntInRange(key, 500, 1500);
  return pickIntInRange(key, 500, 2000);
}

async function main() {
  const adminId = await requireSuperAdminId();
  const { animations, videoEditing } = await requireDepartments();

  const classDefs = await getClassDefs();

  const users = await ensureWorkers(adminId, { animationsId: animations.id, videoId: videoEditing.id });

  // Past months = last 7 full months before Feb 2026
  const currentMonthStart = startOfMonthUTC(NOW); // Feb 2026
  const pastMonthStarts: Date[] = [];
  for (let i = 7; i >= 1; i--) {
    pastMonthStarts.push(addMonthsUTC(currentMonthStart, -i)); // Jul 2025 .. Jan 2026
  }

  // Clean up existing seeded data by our marker (optional but safe):
  // We tag titles with `[SEED-PERF]` so we can delete only those projects if re-running.
  // Delete in safe order.
  const existing = await prisma.project.findMany({
    where: { title: { startsWith: "[SEED-PERF]" } },
    select: { id: true },
  });
  if (existing.length > 0) {
    const ids = existing.map((p) => p.id);
    await prisma.projectRating.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.onsitePointCredit.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectPaymentLine.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectAssignment.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectMessage.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.projectActivity.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
  }

  // Also delete our prior manual adjustment lines (projectId null) created by this seed (identified by note prefix)
  await prisma.projectPaymentLine.deleteMany({
    where: {
      projectId: null,
      note: { startsWith: "[SEED-PERF]" },
    },
  });

  for (const u of users) {
    // Current month active projects
    const activeCount = 2;
    const cancelledCountCurrent = 1;

    for (let i = 0; i < activeCount; i++) {
      const key = `${u.username}::CURRENT::ACTIVE::${i}`;
      const createdAt = addMonthsUTC(NOW, -1);
      const assignedAt = addMonthsUTC(NOW, 0); // Feb

      const p = await prisma.project.create({
        data: {
          title: `[SEED-PERF] ${u.username} Active ${i + 1}`,
          description: `Active project for performance/payments testing.`,
          departmentId: u.deptId,
          status: ProjectStatus.IN_PROGRESS,
          deadlineHours: pickIntInRange(key, 24, 120),
          timerRunning: true,
          timerLastResumedAt: new Date(NOW.getTime() - pickIntInRange(key, 3600, 86400) * 1000),
          timerAccumulatedSeconds: pickIntInRange(key, 2000, 20000),
          createdById: adminId,
          createdAt,
        },
      });

      await prisma.projectAssignment.create({
        data: {
          projectId: p.id,
          userId: u.id,
          assignedById: adminId,
          assignedAt,
        },
      });

      // Remote price for remote workers (optional but useful)
      if (u.workerType === WorkerType.REMOTE_ANIMATOR || u.workerType === WorkerType.REMOTE_VIDEO_EDITOR) {
        const amt = remoteAmountForProject(key);
        await prisma.project.update({
          where: { id: p.id },
          data: { remotePrice: amt },
        });
      }
    }

    for (let i = 0; i < cancelledCountCurrent; i++) {
      const key = `${u.username}::CURRENT::CANCELLED::${i}`;
      const createdAt = addMonthsUTC(NOW, -1);
      const assignedAt = addMonthsUTC(NOW, 0);

      const p = await prisma.project.create({
        data: {
          title: `[SEED-PERF] ${u.username} Cancelled (Current) ${i + 1}`,
          description: `Cancelled project for testing cancelled filters.`,
          departmentId: u.deptId,
          status: ProjectStatus.CANCELLED,
          deadlineHours: pickIntInRange(key, 24, 120),
          timerRunning: false,
          createdById: adminId,
          createdAt,
        },
      });

      await prisma.projectAssignment.create({
        data: {
          projectId: p.id,
          userId: u.id,
          assignedById: adminId,
          assignedAt,
          unassignedAt: addMonthsUTC(assignedAt, 0),
        },
      });
    }

    // Past months: 8–10 COMPLETED per month per user + 0–1 cancelled sometimes
    for (const mStart of pastMonthStarts) {
      const mk = monthKeyFromDate(mStart);
      const count = pickCount8to10(`${u.username}::${mk}::COUNT`);
      const tier = monthTierForUserMonth(u.username, mk);

      // Some months also include a cancelled project (1 out of 3 months)
      const cancelledThisMonth = (hashStringToInt(`${u.username}::${mk}::CXL`) % 3) === 0 ? 1 : 0;

      for (let i = 0; i < count; i++) {
        const key = `${u.username}::${mk}::COMPLETED::${i}`;
        const completedAt = randomDayInMonth(key, mStart);
        const assignedAt = new Date(completedAt.getTime() - pickIntInRange(key, 2, 10) * 24 * 3600 * 1000);

        // For onsite animators: set classDef if available (purely reference)
        const maybeClassDef = (u.workerType === WorkerType.ONSITE_ANIMATOR && classDefs.length > 0)
          ? pickFrom(key, classDefs)
          : null;

        const p = await prisma.project.create({
          data: {
            title: `[SEED-PERF] ${u.username} ${mk} Completed ${i + 1}`,
            description: `Completed project in ${mk}.`,
            departmentId: u.deptId,
            status: ProjectStatus.COMPLETED,
            deadlineHours: pickIntInRange(key, 24, 120),
            timerRunning: false,
            timerAccumulatedSeconds: pickIntInRange(key, 3000, 60000),
            firstCompletedAt: completedAt,
            createdById: adminId,
            createdAt: new Date(assignedAt.getTime() - 24 * 3600 * 1000),
            remotePrice:
              (u.workerType === WorkerType.REMOTE_ANIMATOR || u.workerType === WorkerType.REMOTE_VIDEO_EDITOR)
                ? remoteAmountForProject(key)
                : null,
            // Onsite reference fields (credits are the real truth)
            onsitePointsManual: (u.workerType === WorkerType.ONSITE_VIDEO_EDITOR) ? pickIntInRange(key, 7, 20) : null,
            projectClassDefinitionId: maybeClassDef?.id ?? null,
          },
        });

        await prisma.projectAssignment.create({
          data: {
            projectId: p.id,
            userId: u.id,
            assignedById: adminId,
            assignedAt,
          },
        });

        // Immutable BD rating (use SUPER_ADMIN as rater to avoid creating extra users)
        const r = ratingForProject(key);
        await prisma.projectRating.create({
          data: {
            projectId: p.id,
            ratedById: adminId,
            communication: r.communication,
            quality: r.quality,
            speed: r.speed,
            ratedAt: new Date(completedAt.getTime() + 2 * 3600 * 1000),
          },
        });

        // Onsite credits
        if (u.workerType === WorkerType.ONSITE_ANIMATOR || u.workerType === WorkerType.ONSITE_VIDEO_EDITOR) {
          const pts = computeOnsitePointsForProject(key, tier);
          await prisma.onsitePointCredit.create({
            data: {
              projectId: p.id,
              userId: u.id,
              points: pts,
              setById: adminId,
              monthKey: mk,
              createdAt: new Date(completedAt.getTime() + 1 * 3600 * 1000),
            },
          });
        }

        // Remote payments
        if (u.workerType === WorkerType.REMOTE_ANIMATOR || u.workerType === WorkerType.REMOTE_VIDEO_EDITOR) {
          const amount = Number(p.remotePrice ?? remoteAmountForProject(key));
          const payableOn = payableOnForCompletion(completedAt);

          // Past months generally PAID, but for Jan 2026 (payable Feb 10) keep mixed PAID/UNPAID
          const isJan2026 = mk === "2026-01";
          const shouldBePaid =
            !isJan2026 || ((hashStringToInt(`${key}::PAIDROLL`) % 100) < 55); // Jan: ~55% paid, rest unpaid

          await prisma.projectPaymentLine.create({
            data: {
              projectId: p.id,
              userId: u.id,
              amount,
              status: shouldBePaid ? PaymentLineStatus.PAID : PaymentLineStatus.UNPAID,
              payableOn,
              paidAt: shouldBePaid ? new Date(payableOn.getTime() + 2 * 3600 * 1000) : null,
              paidById: shouldBePaid ? adminId : null,
              note: shouldBePaid ? "Seed: paid history" : "Seed: current unpaid pipeline",
              createdAt: new Date(completedAt.getTime() + 3 * 3600 * 1000),
            },
          });

          // Manual adjustments (fines/bonuses) occasionally
          const adjRoll = hashStringToInt(`${key}::ADJ`) % 100;
          if (adjRoll < 25) {
            const adjAmount = manualAdjustmentAmount(`${key}::ADJAMT`);
            const adjPayableOn = payableOn; // same cycle
            const adjPaid =
              !isJan2026 || ((hashStringToInt(`${key}::ADJPAID`) % 100) < 60);

            await prisma.projectPaymentLine.create({
              data: {
                projectId: null,
                userId: u.id,
                amount: adjAmount,
                status: adjPaid ? PaymentLineStatus.PAID : PaymentLineStatus.UNPAID,
                payableOn: adjPayableOn,
                paidAt: adjPaid ? new Date(adjPayableOn.getTime() + 1 * 3600 * 1000) : null,
                paidById: adjPaid ? adminId : null,
                note: `[SEED-PERF] ${adjAmount < 0 ? "Manual Fine" : "Bonus"} (${mk})`,
                createdAt: new Date(completedAt.getTime() + 4 * 3600 * 1000),
              },
            });
          }
        }
      }

      // Cancelled in some past months (optional)
      for (let c = 0; c < cancelledThisMonth; c++) {
        const key = `${u.username}::${mk}::CANCELLED::${c}`;
        const createdAt = randomDayInMonth(key, mStart);
        const assignedAt = new Date(createdAt.getTime() + 2 * 24 * 3600 * 1000);

        const p = await prisma.project.create({
          data: {
            title: `[SEED-PERF] ${u.username} ${mk} Cancelled ${c + 1}`,
            description: `Cancelled project in ${mk}.`,
            departmentId: u.deptId,
            status: ProjectStatus.CANCELLED,
            deadlineHours: pickIntInRange(key, 24, 120),
            timerRunning: false,
            createdById: adminId,
            createdAt,
          },
        });

        await prisma.projectAssignment.create({
          data: {
            projectId: p.id,
            userId: u.id,
            assignedById: adminId,
            assignedAt,
            unassignedAt: new Date(assignedAt.getTime() + 24 * 3600 * 1000),
          },
        });
      }
    }
  }

  console.log("✅ Seed complete: performance + payments dataset generated.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
  // getPrisma() is a singleton in this codebase; no disconnect needed.
});

