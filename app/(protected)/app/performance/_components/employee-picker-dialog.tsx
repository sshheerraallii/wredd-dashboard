"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function EmployeePickerDialog({
  title,
  users,
  hrefBase,
}: {
  title: string;
  users: { id: string; fullName: string }[];
  hrefBase: string; // full URL base ending with userId=
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter((u) => u.fullName.toLowerCase().includes(s));
  }, [q, users]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Select employee</Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search by name..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />

          <div className="max-h-[420px] overflow-auto rounded-md border">
            {filtered.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No results.</div>
            ) : (
              <div className="divide-y">
                {filtered.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(`${hrefBase}${u.id}`);
                    }}
                    className="w-full text-left p-3 text-sm hover:bg-muted"
                  >
                    {u.fullName}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
