import Link from "next/link";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "./actions";
import { PendingForm, PendingSubmitButton } from "@/components/forms/pending-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const ok = searchParams?.ok ? decodeURIComponent(searchParams.ok) : null;

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Forgot password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email. We’ll send a reset link.
        </p>
        {ok ? <div className="rounded-md border p-3 text-sm">{ok}</div> : null}
      </div>

      <PendingForm action={requestPasswordReset} className="space-y-4">
        {(pending) => (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input name="email" type="email" placeholder="you@wredd.com" required disabled={pending} />
            </div>

            <PendingSubmitButton pending={pending} pendingLabel="Sending…" className="w-full">
              Send reset link
            </PendingSubmitButton>

            <div className="text-center text-xs text-muted-foreground">
              <Link className="underline" href="/login">
                Back to login
              </Link>
            </div>
          </>
        )}
      </PendingForm>
    </div>
  );
}
