"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormatToolbar } from "./format-toolbar";
import { sendChatMessage } from "../actions/chat";

type Props = {
  projectId: string;
  canPost: boolean;
};

export function ChatComposer({ projectId, canPost }: Props) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);

  function submit() {
    setErr(null);
    const trimmed = content.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res = await sendChatMessage({ projectId, content: trimmed });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setContent("");
      // Auto-focus for rapid messaging
      textareaRef.current?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  if (!canPost) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Read-only: you can chat once you’re assigned to this project.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <FormatToolbar textareaRef={textareaRef} />
      </div>

      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a message… Paste links, add **bold**, __underline__, lists, emojis 🙂  (Enter = send, Shift+Enter = new line)"
        className="min-h-[120px] resize-y"
        disabled={pending}
      />

      <div className="mt-3 flex items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending || !content.trim()}>
          Send
        </Button>
        {err ? <div className="text-sm text-red-400">{err}</div> : null}
        <div className="ml-auto text-xs text-muted-foreground">
          Links open in a new tab.
        </div>
      </div>
    </div>
  );
}
