"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { requireRole } from "@/lib/guards";
import { notify } from "@/lib/notify";
import { Prisma } from "@prisma/client";
import { SYSTEM_BD_EMAIL, SYSTEM_BD_KEY } from "@/lib/bd-commission/constants";

const prisma = getPrisma();

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

function backWithError(msg: string): never {
  redirect(`/app/projects/new?err=${encodeURIComponent(msg)}`);
}
function parseUsdRequired(raw: unknown, fieldLabel: string): Prisma.Decimal {
  const s = String(raw ?? "").trim();
  if (!s) backWithError(`${fieldLabel} is required`);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) backWithError(`${fieldLabel} must be a valid USD amount`);
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) backWithError(`${fieldLabel} must be greater than 0`);
  return new Prisma.Decimal(n.toFixed(2));
}

/**
 * Parses percent value (0..100) with up to 2 decimals.
 * Returns null if empty.
 */
function parsePercentOptional(raw: unknown, fieldLabel: string): Prisma.Decimal | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Allow: 20, 20.0, 20.00
  if (!/^\d+(\.\d{1,2})?$/.test(s)) backWithError(`${fieldLabel} must be a valid percent (e.g., 20 or 20.5)`);

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) backWithError(`${fieldLabel} must be 0 or more`);
  if (n > 100) backWithError(`${fieldLabel} cannot exceed 100`);

  return new Prisma.Decimal(n.toFixed(2));
}

async function getSystemBdIdOrThrow(): Promise<string> {
  const u =
    (await prisma.user.findUnique({
      where: { username: SYSTEM_BD_KEY },
      select: { id: true, archivedAt: true },
    })) ??
    (await prisma.user.findUnique({
      where: { email: SYSTEM_BD_EMAIL },
      select: { id: true, archivedAt: true },
    }));

  if (!u || u.archivedAt) {
    backWithError("System BD missing. Run seed-system-bd.ts");
  }
  return u.id;
}

const CreateProjectSchema = z.object({
  title: z.string().trim().min(2, "Title is too short").max(120, "Title is too long"),
  description: z.string().trim().max(5000, "Description is too long").optional(),
  departmentId: z.string().min(1, "Department is required"),
  deadlineHours: z.coerce
    .number()
    .int()
    .min(0, "Deadline must be 0 or more")
    .max(24 * 365, "Deadline too large"),

  // Finance metadata
  clientName: z.string().trim().max(200).optional(),
  clientUsername: z.string().trim().max(200).optional(),

  // Finance fields
  portal: z.enum(["UPWORK", "FIVERR", "DIRECT", "OTHER"], { message: "Invalid portal" }),

  // Decimals parsed separately
  priceUsdRaw: z.any(),
  platformFeePercentRaw: z.any(),
});

export async function createProject(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER", "BUSINESS_DEVELOPER"]);

  const session = await readSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED_ROLES.has(session.user.role)) redirect("/app");

  const parsed = CreateProjectSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    departmentId: formData.get("departmentId"),
    deadlineHours: formData.get("deadlineHours"),

    clientName: formData.get("clientName"),
    clientUsername: formData.get("clientUsername"),

    portal: formData.get("portal"),

    priceUsdRaw: formData.get("priceUsd"),
    platformFeePercentRaw: formData.get("platformFeePercent"),
  });

  if (!parsed.success) {
    backWithError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const departmentExists = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
    select: { id: true },
  });
  if (!departmentExists) backWithError("Department not found");

  const description =
    parsed.data.description && parsed.data.description.trim().length > 0
      ? parsed.data.description.trim()
      : null;

  const actorId = session.user.id;
  const role = session.user.role;

  const clientName =
    parsed.data.clientName && parsed.data.clientName.trim().length > 0
      ? parsed.data.clientName.trim()
      : null;

  const clientUsername =
    parsed.data.clientUsername && parsed.data.clientUsername.trim().length > 0
      ? parsed.data.clientUsername.trim()
      : null;

  // ✅ Required USD price
  const priceUsd = parseUsdRequired(parsed.data.priceUsdRaw, "Price (USD)");

  // ✅ Percent (0..100)
 const platformFeePercent =
  parsePercentOptional(parsed.data.platformFeePercentRaw, "Platform fee (%)") ??
  new Prisma.Decimal("0.00");

  // bdOwnerId rules:
  // - BD creates => self
  // - Admin/Manager creates => System BD
  const bdOwnerId = role === "BUSINESS_DEVELOPER" ? actorId : await getSystemBdIdOrThrow();

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        title: parsed.data.title,
        description,
        departmentId: parsed.data.departmentId,
        deadlineHours: parsed.data.deadlineHours,
        createdById: actorId,
        bdOwnerId,
      },
      select: { id: true, title: true, departmentId: true },
    });

    await tx.projectFinance.create({
      data: {
        projectId: project.id,
        clientName,
        clientUsername,

        // default; assignment will auto-sync later
        workType: "REMOTE",
        allowedHours: null,

        portal: parsed.data.portal,
        priceUsd,
        platformFeePercent,
      } as any,
      select: { id: true },
    });

    if (ALLOWED_ROLES.has(role)) {
      await tx.projectWatcher.upsert({
        where: { projectId_userId: { projectId: project.id, userId: actorId } },
        update: {},
        create: { projectId: project.id, userId: actorId },
      });
    }

    return project;
  });

  await notify({
    type: "PROJECT_CREATED_UNASSIGNED",
    projectId: created.id,
    actorId,
    title: `New project posted: ${created.title}`,
    body: "A new unassigned project is available in your department.",
    href: `/app/projects/${created.id}`,
    recipients: {
      kind: "DEPARTMENT_USERS",
      departmentId: created.departmentId,
      workersOnly: true,
    },
  });

  redirect(`/app/projects/${created.id}`);
}