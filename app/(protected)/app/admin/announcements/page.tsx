import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { uploadProjectBanners } from "./actions";
import { Button } from "@/components/ui/button";

type Role = "SUPER_ADMIN" | "MANAGER" | "BUSINESS_DEVELOPER" | "BD" | "REMOTE_WORKER" | "ONSITE_EMPLOYEE";

export default async function AnnouncementsAdminPage({
  searchParams,
}: {
  searchParams: { ok?: string; err?: string };
}) {
  const session = await readSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") redirect("/app?err=forbidden");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Project Dashboard Banners</h1>
        <p className="text-sm text-muted-foreground">
          Upload 1–4 JPG/PNG banners. They appear only on project dashboards (not project detail pages).
        </p>
      </div>

      {searchParams.ok ? (
        <div className="rounded-xl border bg-card p-4 text-sm">{searchParams.ok}</div>
      ) : null}
      {searchParams.err ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {searchParams.err}
        </div>
      ) : null}

      <form action={uploadProjectBanners} encType="multipart/form-data" className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">Banners (max 4)</div>
          <input
            name="banners"
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="block w-full text-sm"
          />
          <div className="text-xs text-muted-foreground">
            Recommended size: 1600×400 (4:1). Naming is handled automatically.
          </div>
        </div>

        <Button type="submit">Upload</Button>
      </form>
    </div>
  );
}
