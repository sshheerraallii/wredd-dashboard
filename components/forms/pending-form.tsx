// components/forms/pending-form.tsx
"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Wraps a <form action={serverAction}> with React's useTransition so we get
 * a `pending` flag for free — no useFormStatus dependency (not available on
 * React 18.2, which this project is pinned to).
 *
 * Each <PendingForm> instance has its own isolated pending state, so this is
 * safe to use inside a table loop (one form per row) without rows blocking
 * each other.
 *
 * Usage:
 *   <PendingForm action={updateThing}>
 *     {(pending) => (
 *       <>
 *         <input type="hidden" name="id" value={id} />
 *         <PendingSubmitButton pending={pending}>Save</PendingSubmitButton>
 *       </>
 *     )}
 *   </PendingForm>
 */
export function PendingForm({
  action,
  className,
  children,
  onSuccess,
  ...formProps
}: {
  action: (formData: FormData) => unknown | Promise<unknown>;
  className?: string;
  children: (pending: boolean) => React.ReactNode;
  /** Optional callback fired after the action resolves (e.g. close a dialog). */
  onSuccess?: () => void;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "className" | "children">) {
  const [pending, start] = useTransition();

  return (
    <form
      className={className}
      {...formProps}
      action={(formData: FormData) => {
        start(async () => {
          await action(formData);
          onSuccess?.();
        });
      }}
    >
      {children(pending)}
    </form>
  );
}

/**
 * Drop-in replacement for a submit <Button>. Disables itself while its
 * parent <PendingForm> is pending and swaps to a "Saving…" style label.
 * Pass `disabled` for your own validation — it's combined with `pending`.
 */
export function PendingSubmitButton({
  pending,
  pendingLabel = "Saving…",
  children,
  disabled,
  className,
  ...props
}: {
  pending: boolean;
  pendingLabel?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Button>, "type">) {
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      className={cn(className)}
      {...props}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * Same idea but for a plain unstyled <button> (some inline/table forms in
 * this codebase use raw <button> instead of the shadcn <Button>). Kept
 * intentionally minimal so it inherits whatever className the call site
 * already had.
 */
export function PendingPlainSubmitButton({
  pending,
  pendingLabel = "Saving…",
  children,
  className,
  disabled,
  ...props
}: {
  pending: boolean;
  pendingLabel?: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        className,
        pending && "opacity-50 pointer-events-none"
      )}
      {...props}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
