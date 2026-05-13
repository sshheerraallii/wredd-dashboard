"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // NextAuth uses `callbackUrl`. Your older flow used `next`.
  const callbackUrl =
    searchParams.get("callbackUrl") ||
    searchParams.get("next") ||
    "/app";

  const [identifier, setIdentifier] = useState(""); // email or username
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      redirect: false,
      identifier: identifier.trim(),
      password,
      callbackUrl,
    });

    setLoading(false);

    // On failure, do NOT navigate (prevents 405)
    if (!res || res.error || res.ok === false) {
      setError("Invalid credentials");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Login</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to continue.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-border p-3 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email or Username</label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@wredd.com"
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <Link href="/forgot-password" className="text-xs underline text-muted-foreground">
  Forgot password?
</Link>



          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Continue"}
          </Button>

          <p className="text-xs text-muted-foreground">
            After login you’ll be redirected to{" "}
            <Link className="underline" href={callbackUrl}>
              {callbackUrl}
            </Link>
            .
          </p>
        </form>
      </div>
    </div>
  );
}
