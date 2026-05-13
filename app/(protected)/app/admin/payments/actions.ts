"use server";

import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/guards";

const prisma = getPrisma();

function requireManagerOrAdmin(role?: string) {
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/app?err=forbidden");
  }
}

function back(msg: string) {
  redirect(`/app/admin/payments?err=${encodeURIComponent(msg)}`);
}

export async function markPaymentLinePaid(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const session = await readSession();
  requireManagerOrAdmin((session?.user as any)?.role);

  const lineId = String(formData.get("lineId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!lineId) back("Missing payment line id.");

  const line = await prisma.projectPaymentLine.findUnique({
    where: { id: lineId },
    select: { id: true, status: true },
  });

  if (!line) back("Payment line not found.");
  if (line.status === "PAID" || line.status === "EXCEPTION_PAID")
    back("Payment already finalized.");
  if (line.status === "VOIDED") back("Cannot pay a voided line.");

  await prisma.projectPaymentLine.update({
    where: { id: lineId },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidById: (session?.user as any)?.id ?? null,
      note: note || null,
    },
  });

  revalidatePath("/app/admin/payments");
  redirect(`/app/admin/payments?ok=${encodeURIComponent("Marked as paid")}`);
}

export async function markPaymentLineExceptionPaid(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const session = await readSession();
  requireManagerOrAdmin((session?.user as any)?.role);

  const lineId = String(formData.get("lineId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!lineId) back("Missing payment line id.");

  const line = await prisma.projectPaymentLine.findUnique({
    where: { id: lineId },
    select: { id: true, status: true },
  });

  if (!line) back("Payment line not found.");
  if (line.status === "PAID" || line.status === "EXCEPTION_PAID")
    back("Payment already finalized.");
  if (line.status === "VOIDED") back("Cannot pay a voided line.");

  await prisma.projectPaymentLine.update({
    where: { id: lineId },
    data: {
      status: "EXCEPTION_PAID",
      paidAt: new Date(),
      paidById: (session?.user as any)?.id ?? null,
      note: note || null,
    },
  });

  revalidatePath("/app/admin/payments");
  redirect(
    `/app/admin/payments?ok=${encodeURIComponent("Marked as exception paid")}`
  );
}

/**
 * Step 4A: Mark ALL unpaid lines for a specific worker as PAID
 * - Only affects UNPAID lines (never touches PAID/EXCEPTION/VOIDED)
 */
export async function markAllWorkerUnpaidPaid(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const session = await readSession();
  requireManagerOrAdmin((session?.user as any)?.role);

  const workerId = String(formData.get("workerId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!workerId) {
    redirect(`/app/admin/payments?tab=worker&err=${encodeURIComponent("Missing worker id.")}`);
  }

  const now = new Date();

  await prisma.projectPaymentLine.updateMany({
    where: {
      userId: workerId,
      status: "UNPAID",
      NOT: { status: "VOIDED" },
    },
    data: {
      status: "PAID",
      paidAt: now,
      paidById: (session?.user as any)?.id ?? null,
      note: note || null,
    },
  });

  revalidatePath("/app/admin/payments");
  redirect(
    `/app/admin/payments?tab=worker&workerId=${encodeURIComponent(workerId)}&ok=${encodeURIComponent(
      "Marked all unpaid as paid"
    )}`
  );
}

/**
 * Step 4B: Create manual bonus/fine entry for a worker
 * - Requires schema change: projectId must be nullable
 * - Amount is saved as positive for BONUS, negative for FINE
 */
export async function createManualPaymentEntry(formData: FormData) {
  await requireRole(["SUPER_ADMIN", "MANAGER"]);

  const session = await readSession();
  requireManagerOrAdmin((session?.user as any)?.role);

  const workerId = String(formData.get("workerId") ?? "").trim();
  const kind = String(formData.get("kind") ?? "BONUS").toUpperCase(); // BONUS | FINE
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const projectIdRaw = String(formData.get("projectId") ?? "").trim();

  if (!workerId) {
    redirect(`/app/admin/payments?tab=worker&err=${encodeURIComponent("Missing worker id.")}`);
  }
  if (!amountRaw) {
    redirect(
      `/app/admin/payments?tab=worker&workerId=${encodeURIComponent(workerId)}&err=${encodeURIComponent(
        "Missing amount."
      )}`
    );
  }
  if (!reason) {
    redirect(
      `/app/admin/payments?tab=worker&workerId=${encodeURIComponent(workerId)}&err=${encodeURIComponent(
        "Missing reason."
      )}`
    );
  }

  const n = Number(amountRaw);
  if (!Number.isFinite(n) || n <= 0) {
    redirect(
      `/app/admin/payments?tab=worker&workerId=${encodeURIComponent(workerId)}&err=${encodeURIComponent(
        "Invalid amount."
      )}`
    );
  }

  const signed = kind === "FINE" ? -Math.abs(n) : Math.abs(n);

  await prisma.projectPaymentLine.create({
    data: {
      userId: workerId,
      projectId: projectIdRaw || null, // ✅ requires projectId String? in schema
      amount: signed as any, // Prisma Decimal accepts number
      status: "UNPAID",
      payableOn: new Date(),
      note: reason || null,
    } as any,
  });

  revalidatePath("/app/admin/payments");
  redirect(
    `/app/admin/payments?tab=worker&workerId=${encodeURIComponent(workerId)}&ok=${encodeURIComponent(
      "Manual entry created"
    )}`
  );
}
