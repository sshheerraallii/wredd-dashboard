import Link from "next/link";
import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { completeRegistration } from "./actions";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";
import { PendingForm, PendingSubmitButton } from "@/components/forms/pending-form";

const prisma = getPrisma();

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: { token?: string; err?: string };
}) {
  const token = searchParams?.token;
  const err = searchParams?.err ? decodeURIComponent(searchParams.err) : null;

  if (!token) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Register</h1>
        <p className="text-sm text-muted-foreground">Missing invite token.</p>
        <Button asChild variant="secondary">
          <Link href="/login">Back to login</Link>
        </Button>
      </div>
    );
  }

  // Soft validation server-side (so users get a clean message, not a hard crash)
  const tokenHash = hashToken(token);
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash },
    select: { status: true, expiresAt: true, email: true, role: true },
  });

  if (!invite) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Invalid invite</h1>
        <p className="text-sm text-muted-foreground">This invite link is invalid or expired.</p>
        <Button asChild variant="secondary">
          <Link href="/login">Back to login</Link>
        </Button>
      </div>
    );
  }

  if (invite.status !== "PENDING" || invite.expiresAt.getTime() < Date.now()) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Invite not usable</h1>
        <p className="text-sm text-muted-foreground">
          This invite is no longer valid. Ask admin to resend a fresh invite.
        </p>
        <Button asChild variant="secondary">
          <Link href="/login">Back to login</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Complete registration</h1>
        <p className="text-sm text-muted-foreground">
          Invited as <span className="font-medium">{invite.role}</span> — {invite.email}
        </p>
        {err ? <div className="rounded-md border p-3 text-sm">{err}</div> : null}
      </div>

      <PendingForm action={completeRegistration} className="space-y-4">
        {(pending) => (
          <>
            <input type="hidden" name="token" value={token} />

            <div className="space-y-2">
              <label className="text-sm font-medium">Full name</label>
              <Input name="fullName" placeholder="e.g., Sher Ali" required disabled={pending} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input name="username" placeholder="e.g., sher" required disabled={pending} />
              <div className="text-xs text-muted-foreground">No spaces. Must be unique.</div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input name="password" type="password" placeholder="Minimum 8 characters" required disabled={pending} />
            </div>

            <PendingSubmitButton pending={pending} pendingLabel="Creating…" className="w-full">
              Create account
            </PendingSubmitButton>

            <div className="text-center text-xs text-muted-foreground">
              Already have an account? <Link className="underline" href="/login">Login</Link>
            </div>
          </>
        )}
      </PendingForm>
    </div>
  );
}
