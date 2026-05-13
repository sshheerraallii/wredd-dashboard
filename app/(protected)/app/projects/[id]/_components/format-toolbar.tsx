"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

type Props = {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
};

function wrapSelection(
  el: HTMLTextAreaElement,
  left: string,
  right: string = left,
  fallbackText = ""
) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const value = el.value;

  const selected = value.slice(start, end);
  const inside = selected || fallbackText;

  const next = value.slice(0, start) + left + inside + right + value.slice(end);
  el.value = next;

  const cursorStart = start + left.length;
  const cursorEnd = cursorStart + inside.length;

  // restore selection/cursor
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(cursorStart, cursorEnd);
  });
}

function insertLinePrefix(el: HTMLTextAreaElement, prefix: string) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const value = el.value;

  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);

  const lines = (selected || "").split("\n");
  const nextSelected = lines.map((l) => (l.length ? `${prefix}${l}` : l)).join("\n");

  const next = before + nextSelected + after;
  el.value = next;

  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start, start + nextSelected.length);
  });
}

export function FormatToolbar({ textareaRef }: Props) {
  function onBold() {
    const el = textareaRef.current;
    if (!el) return;
    wrapSelection(el, "**", "**", "bold text");
  }

  function onUnderline() {
    const el = textareaRef.current;
    if (!el) return;
    wrapSelection(el, "__", "__", "underlined text");
  }

  function onBullets() {
    const el = textareaRef.current;
    if (!el) return;
    insertLinePrefix(el, "- ");
  }

  function onNumbered() {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const value = el.value;

    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);

    const lines = (selected || "").split("\n");
    const nextSelected = lines
      .map((l, idx) => (l.length ? `${idx + 1}. ${l}` : l))
      .join("\n");

    el.value = before + nextSelected + after;

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + nextSelected.length);
    });
  }

  function onEmoji() {
    // Lightweight: inserts a common emoji. Users can still use OS emoji picker.
    const el = textareaRef.current;
    if (!el) return;

    const emoji = "🙂";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const value = el.value;
    el.value = value.slice(0, start) + emoji + value.slice(end);

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={onBold}>
        Bold
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onUnderline}>
        Underline
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onBullets}>
        • Bullets
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onNumbered}>
        1. List
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onEmoji}>
        🙂
      </Button>

      <div className="ml-auto text-xs text-muted-foreground">
        Formatting: <span className="font-mono">**bold**</span>,{" "}
        <span className="font-mono">__underline__</span>,{" "}
        <span className="font-mono">- bullets</span>,{" "}
        <span className="font-mono">1. list</span>
      </div>
    </div>
  );
}
