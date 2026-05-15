import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { AppShell } from "@/components/app/app-shell";
import { Suspense } from "react";
import { SearchParamsToaster } from "@/components/app/search-params-toaster";


export default async function ProtectedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  // Hard-block archived users at render time (DB-aware via jwt refresh)
  if ((session.user as any).archivedAt) redirect("/archived");

  return (
    <AppShell>
      {children}
      <Suspense fallback={null}>
        <SearchParamsToaster />
      </Suspense>
    </AppShell>
  );
}
