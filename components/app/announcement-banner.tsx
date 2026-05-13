import { headers } from "next/headers";
import { AnnouncementSlider } from "@/components/app/announcement-slider";

type Manifest = { slides?: string[] };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  return `${proto}://${host}`;
}

export async function AnnouncementBanner() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return null;

  const res = await fetch(`${baseUrl}/announcements/projects/manifest.json`, {
    cache: "no-store",
  });

  if (!res.ok) return null;

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;

  const manifest = (await res.json()) as Manifest;
  const slides = (manifest.slides ?? []).filter(Boolean);

  if (!slides.length) return null;

  return (
    <div className="mb-6">
      <AnnouncementSlider
        slides={slides}
        basePath="/announcements/projects"
        intervalMs={5000}
        aspect="16 / 4"
      />
    </div>
  );
}
