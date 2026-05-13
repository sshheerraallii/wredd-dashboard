"use client";

import * as React from "react";
import { ChatComposer } from "./chat-composer";
import { MessageItem, ChatMessage } from "./message-item";

type Props = {
  projectId: string;
  canPost: boolean;
  currentUserId?: string | null;
  messages: ChatMessage[];
};

export function ProjectChat({ projectId, canPost, currentUserId, messages }: Props) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // auto-scroll to bottom on new messages
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Project Chat</div>
        <div className="text-xs text-muted-foreground">
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        {messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <MessageItem key={m.id} msg={m} currentUserId={currentUserId} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <ChatComposer projectId={projectId} canPost={canPost} />
    </div>
  );
}
