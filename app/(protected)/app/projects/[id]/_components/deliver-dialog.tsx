"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deliverProject } from "../actions/delivery";

function isDriveOrDocsUrl(v: string) {
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") return false;
    return host === "drive.google.com" || host === "docs.google.com";
  } catch {
    return false;
  }
}

export function DeliverDialog({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const [driveUrl, setDriveUrl] = React.useState("");
  const [note, setNote] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  function reset() {
    setDriveUrl("");
    setNote("");
    setErr(null);
    setSaving(false);
  }

  function validate() {
    const link = driveUrl.trim();
    const n = note.trim();

    if (!link) return "Google Drive link is required.";
    if (!isDriveOrDocsUrl(link)) return "Link must be a valid https Google Drive/Docs URL.";
    if (!n) return "Delivery notes are required.";
    if (n.length < 3) return "Delivery notes are too short.";
    if (n.length > 5000) return "Delivery notes are too long.";
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setSaving(true);

    try {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("driveUrl", driveUrl.trim());
      fd.set("note", note.trim());

      // Server action will redirect on success / failure.
      // In case it doesn't (edge), we refresh.
      await deliverProject(fd);

      // fallback
      router.refresh();
      setOpen(false);
      reset();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to deliver. Try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled} variant="destructive">
          Submit Delivery
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit delivery</DialogTitle>
          <DialogDescription>
            Add the Google Drive/Docs link and delivery notes. This will mark the project as DELIVERED.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium">Google Drive / Docs link</label>
            <Input
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              autoFocus
            />
            <div className="text-xs text-muted-foreground">
              Only https links from drive.google.com or docs.google.com are accepted.
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Delivery notes</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you deliver? What should BD/Manager review?"
              rows={6}
            />
          </div>

          {err ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              {err}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? "Submitting..." : "Submit & Mark Delivered"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
