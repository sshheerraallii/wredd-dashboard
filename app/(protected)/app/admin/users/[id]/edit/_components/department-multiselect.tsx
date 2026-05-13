"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

type Department = { id: string; name: string };

export default function DepartmentMultiSelect({
  departments,
  value,
  onChange,
}: {
  departments: Department[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {departments.map((d) => {
        const active = value.includes(d.id);
        return (
          <Button
            key={d.id}
            type="button"
            variant={active ? "default" : "secondary"}
            size="sm"
            onClick={() => toggle(d.id)}
            className="rounded-full"
          >
            {d.name}
          </Button>
        );
      })}

      {!departments.length ? (
        <div className="text-sm text-muted-foreground">No departments found.</div>
      ) : null}
    </div>
  );
}
