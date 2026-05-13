"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";

type Item = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  readAt: string | null;
};

function beep() {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as any;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 880; // tone
    g.gain.value = 0.06; // volume

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close?.();
    }, 120);
  } catch {
    // ignore if blocked
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function LiveNotifications() {
  const [toasts, setToasts] = React.useState<Item[]>([]);
  const [unreadCount, setUnreadCount] = React.useState<number>(0);

  // localStorage key (per browser)
  const key = "wredd:lastNotifSeenAt";

  const removeToast = React.useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  React.useEffect(() => {
    let timer: any = null;
    let stopped = false;

    const getLastSeen = () => {
      const v = localStorage.getItem(key);
      return v && v.length > 10 ? v : null;
    };

    const setLastSeen = (iso: string) => {
      localStorage.setItem(key, iso);
    };

    async function tick() {
      if (stopped) return;

      // only poll when tab visible
      if (document.visibilityState !== "visible") return;

      const since = getLastSeen();
      const url = since ? `/api/notifications/poll?since=${encodeURIComponent(since)}` : `/api/notifications/poll`;

      const res = await fetch(url, { cache: "no-store" }).catch(() => null);
      if (!res || !res.ok) return;

      const data = (await res.json()) as {
        ok: boolean;
        unreadCount: number;
        newest: string | null;
        items: Item[];
      };

      if (!data.ok) return;

      setUnreadCount(data.unreadCount);

      // If server returns new items, show them as toasts
      if (data.items && data.items.length) {
        // advance cursor first to avoid duplicates on fast refresh
        if (data.newest) setLastSeen(data.newest);

        // add toasts (cap to 3 on screen)
        setToasts((prev) => {
          const merged = [...prev];
          for (const it of data.items) {
            if (!merged.find((x) => x.id === it.id)) merged.push(it);
          }
          return merged.slice(-3);
        });

        // sound once per batch
        beep();

        // auto-dismiss after 2s each
        for (const it of data.items) {
          setTimeout(() => removeToast(it.id), 2000);
        }
      } else {
        // if first run and no cursor stored, set it so we don't replay old history
        if (!since) setLastSeen(nowIso());
      }
    }

    // initial tick + interval
    tick();
    timer = setInterval(tick, 8000);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [removeToast]);

  // (Optional) expose unreadCount if you later want to sync topbar badge without refresh.
  // For now, your server Topbar count is fine.

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="w-[340px] rounded-xl border bg-card shadow-lg p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{t.title}</div>
              {t.body ? (
                <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {t.body}
                </div>
              ) : null}
              {t.href ? (
                <div className="mt-2">
                  <Link
                    href={t.href}
                    className="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground"
                  >
                    Open
                  </Link>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="shrink-0 rounded-md p-1 hover:bg-muted"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
