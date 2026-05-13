import Link from "next/link";
import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resetPassword } from "./actions";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";

const prisma = getPrisma();

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string; err?: string };
}) {
  const token = searchParams?.token;
  const err = searchParams?.err ? decodeURIComponent(searchParams.err) : null;

  if (!token) redirect("/forgot-password?ok=" + encodeURIComponent("Missing reset token."));

  // Soft check (nice UX)
  const tokenHash = hashToken(token);
  const prt = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { usedAt: true, expiresAt: true },
  });

  if (!prt) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Invalid link</h1>
        <p className="text-sm text-muted-foreground">This reset link is invalid or expired.</p>
        <Button asChild variant="secondary">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (prt.usedAt || prt.expiresAt.getTime() < Date.now()) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Link not usable</h1>
        <p className="text-sm text-muted-foreground">
          This reset link is no longer valid. Request a new one.
        </p>
        <Button asChild variant="secondary">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Set a new password</h1>
        <p className="text-sm text-muted-foreground">Choose a strong password.</p>
        {err ? <div className="rounded-md border p-3 text-sm">{err}</div> : null}
      </div>

      <form action={resetPassword} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <label className="text-sm font-medium">New password</label>
          <Input name="password" type="password" placeholder="Minimum 8 characters" required />
        </div>

        <Button type="submit" className="w-full">
          Update password
        </Button>

        <div className="text-center text-xs text-muted-foreground">
          <Link className="underline" href="/login">Back to login</Link>
        </div>
      </form>
    </div>
  );
}
