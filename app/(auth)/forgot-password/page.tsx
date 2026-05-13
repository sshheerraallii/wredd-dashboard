import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "./actions";

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

      <form action={requestPasswordReset} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <Input name="email" type="email" placeholder="you@wredd.com" required />
        </div>

        <Button type="submit" className="w-full">
          Send reset link
        </Button>

        <div className="text-center text-xs text-muted-foreground">
          <Link className="underline" href="/login">
            Back to login
          </Link>
        </div>
      </form>
    </div>
  );
}
