"use server";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { requireRole } from "@/lib/guards";
import bcrypt from "bcryptjs";

const prisma = getPrisma();

const CreateSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  username: z.string().trim().min(2).max(40),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(6),
  role: z.enum([
  "MANAGER",
  "BUSINESS_DEVELOPER",
  "REMOTE_WORKER",
  "ONSITE_EMPLOYEE",
]),

  workerType: z.enum([
    "ONSITE_VIDEO_EDITOR",
    "REMOTE_VIDEO_EDITOR",
    "ONSITE_ANIMATOR",
    "REMOTE_ANIMATOR",
    "WEB_DEVELOPMENT",
    "OPERATIONS",
  ]),
  departmentIds: z.array(z.string()).default([]),
});

function normalizeUsername(u: string) {
  return u.trim().replace(/\s+/g, "");
}

export async function createUser(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);
  await requireAdmin();

  const rawDeptIds = formData.get("departmentIds");
  const deptIds = (() => {
    if (typeof rawDeptIds !== "string" || !rawDeptIds) return [];
    try {
      const parsed = JSON.parse(rawDeptIds);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const parsed = CreateSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    workerType: formData.get("workerType"),
    departmentIds: deptIds,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const fullName = parsed.data.fullName.trim();
  const username = normalizeUsername(parsed.data.username);
  const email = parsed.data.email;
  const password = parsed.data.password;
  const role = parsed.data.role;
  const workerType = parsed.data.workerType;
  const departmentIds = parsed.data.departmentIds;

  // HARD RULE: cannot create SUPER_ADMIN from UI
  if (role === "SUPER_ADMIN") {
    throw new Error("SUPER_ADMIN cannot be created from the app.");
  }

  const exists = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true },
  });

  if (exists) throw new Error("Email or username already exists");

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      fullName,
      username,
      email,
      passwordHash,
      role,
      workerType,
      departments: {
        create: departmentIds.map((departmentId) => ({ departmentId })),
      },
    },
  });
}
