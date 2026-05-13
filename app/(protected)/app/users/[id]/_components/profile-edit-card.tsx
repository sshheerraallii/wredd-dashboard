"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProfileEditCard({
  defaultFullName,
}: {
  defaultFullName: string;
}) {
  const [preview, setPreview] = React.useState<string | null>(null);

  return (
    <div className="rounded-2xl border bg-card p-5 md:p-6">
      <div className="text-lg font-semibold">Edit Profile</div>
      <div className="mt-1 text-sm text-muted-foreground">
        Update your full name and profile picture.
      </div>

      <div className="mt-5 grid gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Full name</label>
          <Input name="fullName" defaultValue={defaultFullName} maxLength={60} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Profile picture</label>
          <Input
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return setPreview(null);
              setPreview(URL.createObjectURL(f));
            }}
          />

          {preview ? (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">Preview</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Avatar preview"
                className="h-20 w-20 rounded-full border object-cover"
              />
              <div className="mt-2 text-xs text-muted-foreground">
                Will be converted to WEBP and stored under 1 MB.
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              JPG/PNG/WEBP. Stored as WEBP under 1 MB.
            </div>
          )}
        </div>

        <div className="pt-2">
          <Button type="submit">Save</Button>
        </div>
      </div>
    </div>
  );
}
