"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";
import { PaymentAccountType } from "@prisma/client";

const prisma = getPrisma();
const BASE_HREF = "/app/admin/client-payments/accounts";

function backWithError(msg: string) {
  redirect(`${BASE_HREF}?err=${encodeURIComponent(msg)}`);
}

const AccountSchema = z.object({
  name: z.string().trim().min(2, "Too short").max(60, "Too long"),
  type: z.enum(["PAYONEER", "FIVERR", "BANK", "OTHER"]),
  ownerLabel: z.string().trim().max(60).optional(),
});

export async function createPaymentAccount(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const parsed = AccountSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? ""),
    ownerLabel: formData.get("ownerLabel") ?? undefined,
  });

  if (!parsed.success) {
    backWithError(parsed.error.issues[0]?.message ?? "Invalid input");
    return;
  }

  const { name, type, ownerLabel } = parsed.data;

  const exists = await prisma.paymentAccount.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (exists) backWithError("An account with this name already exists");

  await prisma.paymentAccount.create({
    data: {
      name,
      type: type as PaymentAccountType,
      ownerLabel: ownerLabel && ownerLabel.length ? ownerLabel : null,
    },
  });

  revalidatePath(BASE_HREF);
  redirect(`${BASE_HREF}?ok=1`);
}

export async function toggleAccountActive(formData: FormData) {
  await requireRole(["SUPER_ADMIN"]);

  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "1";

  if (!id) backWithError("Missing account");

  await prisma.paymentAccount.update({
    where: { id },
    data: { isActive: nextActive },
  });

  revalidatePath(BASE_HREF);
  redirect(`${BASE_HREF}?ok=1`);
}
