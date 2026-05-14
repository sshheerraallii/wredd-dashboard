"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

function clampIndex(i: number, len: number) {
  if (len <= 0) return 0;
  return (i % len + len) % len;
}

export function AnnouncementSlider({
  slides,
  basePath,
  intervalMs = 5000,
  aspect = "16 / 4",
}: {
  slides: string[];
  basePath: string; // e.g. "/announcements/projects"
  intervalMs?: number;
  aspect?: string;
}) {
  const safeSlides = (slides ?? []).filter(Boolean);
  const len = safeSlides.length;

  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  // Reset index if slides change
  React.useEffect(() => {
    setIndex((i) => clampIndex(i, len));
  }, [len]);

  // Auto-advance
  React.useEffect(() => {
    if (len <= 1) return;
    if (paused) return;

    const t = window.setInterval(() => {
      setIndex((i) => clampIndex(i + 1, len));
    }, intervalMs);

    return () => window.clearInterval(t);
  }, [len, paused, intervalMs]);

  if (len === 0) return null;

  const prev = () => setIndex((i) => clampIndex(i - 1, len));
  const next = () => setIndex((i) => clampIndex(i + 1, len));

  const activeSrc = basePath
  ? `${basePath}/${safeSlides[index]}`
  : safeSlides[index];

  return (
    <div
      className="overflow-hidden rounded-2xl border bg-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Fixed aspect ratio prevents layout shift */}
      <div className="relative w-full" style={{ aspectRatio: aspect }}>
        <Image
          key={activeSrc}
          src={activeSrc}
          alt="Announcement"
          fill
          className="object-cover"
          sizes="100vw"
          unoptimized
          priority
        />

        {len > 1 ? (
          <>
            {/* Prev */}
            <button
              type="button"
              aria-label="Previous announcement"
              onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full border bg-card/80 backdrop-blur hover:bg-muted"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            {/* Next */}
            <button
              type="button"
              aria-label="Next announcement"
              onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full border bg-card/80 backdrop-blur hover:bg-muted"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {/* Dots */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 backdrop-blur">
              {safeSlides.map((_, i) => {
                const active = i === index;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Go to slide ${i + 1}`}
                    onClick={() => setIndex(i)}
                    className={[
                      "h-2.5 w-2.5 rounded-full transition",
                      active ? "bg-foreground" : "bg-muted-foreground/40 hover:bg-muted-foreground/70",
                    ].join(" ")}
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
