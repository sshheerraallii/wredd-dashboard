"use client";

import * as React from "react";

type MsgUser = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: string;
};

export type ChatMessage = {
  id: string;
  type:
    | "TEXT"
    | "LINK"
    | "SYSTEM"
    | "DELIVERY"
    | "REVISION_REQUEST"
    | "STATUS_CHANGE"
    | "DEADLINE_EXTENDED";
  content: string;
  createdAt: string; // ISO
  createdBy?: MsgUser | null;

  // ✅ NEW: support explicit link field (Drive URL stored in ProjectMessage.linkUrl)
  linkUrl?: string | null;
  meta?: any;
};

function displayName(u?: MsgUser | null) {
  return u?.fullName || u?.username || u?.email || "User";
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function linkify(s: string) {
  const urlRe = /\bhttps?:\/\/[^\s<]+/gi;
  return s.replace(urlRe, (url) => {
    const safeUrl = url.replace(/"/g, "%22");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 break-all">${url}</a>`;
  });
}

function applyInlineFormatting(s: string) {
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); // **bold**
  s = s.replace(/__(.+?)__/g, "<u>$1</u>"); // __underline__
  return s;
}

function renderToHtml(raw: string) {
  let s = escapeHtml(raw);

  const lines = s.split("\n");

  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const flushUl = () => {
    if (inUl) out.push("</ul>");
    inUl = false;
  };
  const flushOl = () => {
    if (inOl) out.push("</ol>");
    inOl = false;
  };

  for (const line0 of lines) {
    const line = line0.trimEnd();

    const bullet = /^-\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);

    if (bullet) {
      flushOl();
      if (!inUl) {
        out.push('<ul class="list-disc pl-6 space-y-1">');
        inUl = true;
      }
      out.push(`<li>${applyInlineFormatting(linkify(bullet[1]))}</li>`);
      continue;
    }

    if (numbered) {
      flushUl();
      if (!inOl) {
        out.push('<ol class="list-decimal pl-6 space-y-1">');
        inOl = true;
      }
      out.push(`<li>${applyInlineFormatting(linkify(numbered[1]))}</li>`);
      continue;
    }

    flushUl();
    flushOl();

    if (line.length === 0) {
      out.push('<div class="h-2"></div>');
      continue;
    }

    out.push(`<p class="leading-relaxed">${applyInlineFormatting(linkify(line))}</p>`);
  }

  flushUl();
  flushOl();

  return out.join("");
}

function isSystemType(t: ChatMessage["type"]) {
  return t !== "TEXT" && t !== "LINK";
}

function systemLabel(t: ChatMessage["type"]) {
  if (t === "DELIVERY") return "Delivery";
  if (t === "REVISION_REQUEST") return "Revision requested";
  if (t === "STATUS_CHANGE") return "Status update";
  if (t === "DEADLINE_EXTENDED") return "Deadline extended";
  return "System";
}

function looksLikeUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function renderLinkBlock(msg: ChatMessage) {
  const link = (msg.linkUrl || "").trim();
  if (!link) return null;
  if (!looksLikeUrl(link)) return null;

  // Render as a normal anchor; keep it separate from renderToHtml() content.
  return (
    <div className="mb-2">
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline underline-offset-2 break-all"
      >
        {link}
      </a>
    </div>
  );
}

export function MessageItem({
  msg,
  currentUserId,
}: {
  msg: ChatMessage;
  currentUserId?: string | null;
}) {
  const mine = !!currentUserId && msg.createdBy?.id === currentUserId;

  // ✅ If DELIVERY has linkUrl but content doesn't contain a URL, show it explicitly.
  // Also show for LINK type (since LINK messages are "normal", not system).
  const showExplicitLink = (msg.type === "DELIVERY" || msg.type === "LINK") && !!msg.linkUrl?.trim();

  if (isSystemType(msg.type)) {
    return (
      <div className="flex justify-center">
        <div className="w-full max-w-3xl rounded-xl border bg-muted/20 px-4 py-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border px-2 py-0.5">{systemLabel(msg.type)}</span>
            <span>•</span>
            <span>{formatTime(msg.createdAt)}</span>
          </div>

          {showExplicitLink ? renderLinkBlock(msg) : null}

          <div
            className="text-sm"
            dangerouslySetInnerHTML={{ __html: renderToHtml(msg.content || "") }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`w-full max-w-3xl rounded-2xl border bg-card px-4 py-3 ${
          mine ? "shadow-sm" : ""
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{displayName(msg.createdBy)}</span>
            {msg.createdBy?.role ? <span className="ml-2 opacity-70">({msg.createdBy.role})</span> : null}
          </div>
          <div className="text-xs text-muted-foreground">{formatTime(msg.createdAt)}</div>
        </div>

        {showExplicitLink ? renderLinkBlock(msg) : null}

        <div
          className="text-sm"
          dangerouslySetInnerHTML={{ __html: renderToHtml(msg.content || "") }}
        />
      </div>
    </div>
  );
}
