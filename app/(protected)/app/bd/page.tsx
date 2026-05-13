import { AnnouncementBanner } from "@/components/app/announcement-banner";
import { AnnouncementBannerDismissable } from "@/components/app/announcement-banner-dismissable";
export default function BdHome() {
  return (
    <div className="p-6 space-y-6">
      <AnnouncementBannerDismissable storageKey="wredd:announce:projects">
  <AnnouncementBanner />
</AnnouncementBannerDismissable>
      <div>BD Dashboard (placeholder)</div>
    </div>
  );
}
