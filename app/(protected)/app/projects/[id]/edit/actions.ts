// app/(protected)/app/projects/[id]/edit/actions.ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const prisma = getPrisma();

function requireCanManageProject(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "BUSINESS_DEVELOPER") {
    redirect("/app?err=forbidden");
  }
}

// Edit-local validators: on failure, redirect back to THIS edit page with ?err=
function editError(id: string, msg: string): never {
  redirect(`/app/projects/${id}/edit?err=${encodeURIComponent(msg)}`);
}

function parseUsdRequired(id: string, raw: unknown): Prisma.Decimal {
  const s = String(raw ?? "").trim();
  if (!s) editError(id, "Price (USD) is required");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) editError(id, "Price (USD) must be a valid USD amount");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) editError(id, "Price (USD) must be greater than 0");
  return new Prisma.Decimal(n.toFixed(2));
}

function parsePercentOrZero(id: string, raw: unknown): Prisma.Decimal {
  const s = String(raw ?? "").trim();
  if (!s) return new Prisma.Decimal("0.00");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) editError(id, "Platform fee (%) must be a valid percent (e.g., 20 or 20.5)");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) editError(id, "Platform fee (%) must be 0 or more");
  if (n > 100) editError(id, "Platform fee (%) cannot exceed 100");
  return new Prisma.Decimal(n.toFixed(2));
}

const PORTALS = ["UPWORK", "FIVERR", "DIRECT", "OTHER"] as const;

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(2).max(140),
  description: z.string().max(5000).optional().nullable(),
  departmentId: z.string().min(1),
  deadlineHours: z.coerce.number().int().min(1).max(24 * 365),
  // Finance fields are optional at schema level; they are gated server-side
  // and only applied when the project has never been completed.
  isSample: z.string().optional(),
  portal: z.enum(PORTALS).optional(),
  priceUsdRaw: z.string().optional(),
  platformFeePercentRaw: z.string().optional(),
  clientName: z.string().max(200).optional().nullable(),
  clientUsername: z.string().max(200).optional().nullable(),
});

export async function updateProject(formData: FormData) {
  const session = await readSession();
  requireCanManageProject(session?.user?.role);

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    departmentId: formData.get("departmentId"),
    deadlineHours: formData.get("deadlineHours"),
    isSample: formData.get("isSample"),
    portal: formData.get("portal"),
    priceUsdRaw: formData.get("priceUsd"),
    platformFeePercentRaw: formData.get("platformFeePercent"),
    clientName: formData.get("clientName"),
    clientUsername: formData.get("clientUsername"),
  });

  if (!parsed.success) {
    redirect(`/app/projects?err=invalid_input`);
  }

  const { id, title, description, departmentId, deadlineHours } = parsed.data;

  // Re-check the completion lock server-side. Never trust the client to enforce it.
  const current = await prisma.project.findUnique({
    where: { id },
    select: { id: true, firstCompletedAt: true },
  });
  if (!current) redirect(`/app/projects?err=not_found`);

  const financeEditable = current.firstCompletedAt == null;

  // Core fields stay editable regardless of completion (e.g. fixing a typo).
  const coreData = {
    title,
    description: description ? description : null,
    departmentId,
    deadlineHours,
  };

  if (!financeEditable) {
    // Completed (or reopened-after-completion): finance is locked.
    // Save core fields only; ignore any finance values that came through.
    await prisma.project.update({ where: { id }, data: coreData, select: { id: true } });
    redirect(`/app/projects/${id}?ok=updated`);
  }

  // Finance editable. Parse + apply, including sample <-> priced promotion.
  const isSample = String(parsed.data.isSample ?? "") === "true";

  const priceUsd = isSample
    ? new Prisma.Decimal("0.00")
    : parseUsdRequired(id, parsed.data.priceUsdRaw);

  const platformFeePercent = isSample
    ? new Prisma.Decimal("0.00")
    : parsePercentOrZero(id, parsed.data.platformFeePercentRaw);

  const portal = isSample ? "OTHER" : (parsed.data.portal ?? "OTHER");
  const clientName = (parsed.data.clientName ?? "").trim() || null;
  const clientUsername = (parsed.data.clientUsername ?? "").trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id },
      data: { ...coreData, isSample },
      select: { id: true },
    });

    // upsert handles older projects whose ProjectFinance row may be missing.
    await tx.projectFinance.upsert({
      where: { projectId: id },
      update: {
        priceUsd,
        platformFeePercent,
        portal,
        clientName,
        clientUsername,
      } as any,
      create: {
        projectId: id,
        workType: "REMOTE",
        allowedHours: null,
        priceUsd,
        platformFeePercent,
        portal,
        clientName,
        clientUsername,
      } as any,
    });
  });

  redirect(`/app/projects/${id}?ok=updated`);
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteProject(formData: FormData) {
  const session = await readSession();
  requireCanManageProject(session?.user?.role);

  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) redirect(`/app/projects?err=invalid_input`);

  const { id } = parsed.data;

  // Hard delete (simple + consistent). If you later want soft-delete, we'll add archivedAt/status.
  await prisma.project.delete({ where: { id } });

  redirect(`/app/projects?ok=deleted`);
}
