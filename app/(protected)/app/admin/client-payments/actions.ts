"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";
import { ReceiptFundStatus } from "@prisma/client";

const prisma = getPrisma();

const BASE_HREF = "/app/admin/client-payments";

function withParam(path: string, key: string, value: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}

function backWithError(path: string, msg: string) {
  redirect(withParam(path, "err", msg));
}

/**
 * Popups on the main ledger pass along a `returnTo` hidden field (the list
 * page URL with its current filters) so the redirect after an add/update
 * lands back on the same filtered view instead of a separate project page.
 * Falls back to the /[id] deep-link page for any caller that doesn't send one.
 */
function resolveReturnPath(formData: FormData, projectId: string) {
  const returnTo = formData.get("returnTo");
  if (typeof returnTo === "string" && returnTo.startsWith(BASE_HREF)) return returnTo;
  return `${BASE_HREF}/${projectId}`;
}

const AddReceiptSchema = z.object({
  projectId: z.string().min(1),
  accountId: z.string().min(1, "Choose an account"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  receivedAt: z.string().min(1, "Choose a date"),
  note: z.string().trim().max(500).optional(),
});

export async function addClientPaymentReceipt(formData: FormData) {
  const user = await requireRole(["SUPER_ADMIN"]);

  const parsed = AddReceiptSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    accountId: String(formData.get("accountId") ?? ""),
    amount: formData.get("amount"),
    receivedAt: String(formData.get("receivedAt") ?? ""),
    note: formData.get("note") ?? undefined,
  });

  const projectId = String(formData.get("projectId") ?? "");
  const returnPath = resolveReturnPath(formData, projectId);

  if (!parsed.success) {
    backWithError(returnPath, parsed.error.issues[0]?.message ?? "Invalid input");
    return;
  }

  const { accountId, amount, receivedAt, note } = parsed.data;

  const account = await prisma.paymentAccount.findUnique({
    where: { id: accountId },
    select: { id: true, isActive: true },
  });
  if (!account || !account.isActive) {
    backWithError(returnPath, "Selected account is not available");
    return;
  }

  await prisma.clientPaymentReceipt.create({
    data: {
      projectId,
      accountId,
      amountUsd: amount,
      receivedAt: new Date(receivedAt),
      note: note && note.length ? note : null,
      fundStatus: ReceiptFundStatus.IN_HAND,
      recordedById: user.id,
    },
  });

  revalidatePath(BASE_HREF);
  revalidatePath(`${BASE_HREF}/${projectId}`);
  redirect(withParam(returnPath, "ok", "1"));
}

const UpdateStatusSchema = z.object({
  receiptId: z.string().min(1),
  fundStatus: z.enum(["IN_HAND", "UTILIZED", "SETTLED_TO_WREDD_FBL"]),
  statusNote: z.string().trim().max(500).optional(),
});

export async function updateReceiptFundStatus(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const parsed = UpdateStatusSchema.safeParse({
    receiptId: String(formData.get("receiptId") ?? ""),
    fundStatus: String(formData.get("fundStatus") ?? ""),
    statusNote: formData.get("statusNote") ?? undefined,
  });

  const projectId = String(formData.get("projectId") ?? "");
  const returnPath = resolveReturnPath(formData, projectId);

  if (!parsed.success) {
    backWithError(returnPath, parsed.error.issues[0]?.message ?? "Invalid input");
    return;
  }

  const { receiptId, fundStatus, statusNote } = parsed.data;

  await prisma.clientPaymentReceipt.update({
    where: { id: receiptId },
    data: {
      fundStatus: fundStatus as ReceiptFundStatus,
      statusNote: statusNote && statusNote.length ? statusNote : null,
      statusUpdatedAt: new Date(),
    },
  });

  revalidatePath(BASE_HREF);
  revalidatePath(`${BASE_HREF}/${projectId}`);
  redirect(withParam(returnPath, "ok", "1"));
}

export async function deleteClientPaymentReceipt(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const receiptId = String(formData.get("receiptId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const returnPath = resolveReturnPath(formData, projectId);

  if (!receiptId) {
    backWithError(returnPath, "Missing receipt");
    return;
  }

  await prisma.clientPaymentReceipt.delete({ where: { id: receiptId } });

  revalidatePath(BASE_HREF);
  revalidatePath(`${BASE_HREF}/${projectId}`);
  redirect(withParam(returnPath, "ok", "1"));
}
