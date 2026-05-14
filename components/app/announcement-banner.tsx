import { AnnouncementSlider } from "@/components/app/announcement-slider";
import { getBannerUrls } from "@/app/(protected)/app/admin/announcements/actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function AnnouncementBanner() {
  const urls = await getBannerUrls();
  if (!urls.length) return null;

  return (
    <div className="mb-6">
      <AnnouncementSlider
        slides={urls}
        basePath=""
        intervalMs={5000}
        aspect="16 / 4"
      />
    </div>
  );
}