"use client";

import * as React from "react";
import { X } from "lucide-react";

export function AnnouncementBannerDismissable({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Dismiss announcements"
        className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-card/80 backdrop-blur hover:bg-muted"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}
