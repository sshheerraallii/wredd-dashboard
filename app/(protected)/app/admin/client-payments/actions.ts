"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";
import { ReceiptFundStatus } from "@prisma/client";

const prisma = getPrisma();

const BASE_HREF = "/app/admin/client-payments";

function backWithError(path: string, msg: string) {
  redirect(`${path}?err=${encodeURIComponent(msg)}`);
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
  const returnPath = `${BASE_HREF}/${projectId}`;

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
  revalidatePath(returnPath);
  redirect(`${returnPath}?ok=1`);
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
  const returnPath = `${BASE_HREF}/${projectId}`;

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
  revalidatePath(returnPath);
  redirect(`${returnPath}?ok=1`);
}

export async function deleteClientPaymentReceipt(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const receiptId = String(formData.get("receiptId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const returnPath = `${BASE_HREF}/${projectId}`;

  if (!receiptId) backWithError(returnPath, "Missing receipt");

  await prisma.clientPaymentReceipt.delete({ where: { id: receiptId } });

  revalidatePath(BASE_HREF);
  revalidatePath(returnPath);
  redirect(`${returnPath}?ok=1`);
}
