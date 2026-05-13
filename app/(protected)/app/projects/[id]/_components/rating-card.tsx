"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { createProjectRating } from "../actions/rating";

function StarRow({
  label,
  value,
  onChange,
  required = true,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  hint?: string;
}) {
  const id = React.useId();

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium">
            {label}
            {required ? "" : " (optional)"}
          </label>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>

        {!required && value != null ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div
        id={id}
        className="flex items-center gap-1"
        aria-label={label}
        role="radiogroup"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (value ?? 0) >= n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={[
                "h-9 w-9 grid place-items-center rounded-md border",
                "transition",
                active ? "bg-muted text-foreground" : "bg-background text-muted-foreground",
                "hover:bg-muted/60",
                "focus:outline-none focus:ring-2 focus:ring-primary/40",
              ].join(" ")}
              aria-checked={value === n}
              role="radio"
              title={`${n}/5`}
            >
              <span className="text-lg leading-none">{active ? "★" : "☆"}</span>
            </button>
          );
        })}

        <div className="ml-2 text-xs text-muted-foreground min-w-[3rem]">
          {value != null ? `${value}/5` : required ? "—" : "—"}
        </div>
      </div>
    </div>
  );
}

export function RatingCard({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);

  const [communication, setCommunication] = React.useState<number | null>(null);
  const [quality, setQuality] = React.useState<number | null>(null);
  const [speed, setSpeed] = React.useState<number | null>(null);
  const [professionalism, setProfessionalism] = React.useState<number | null>(null);

  const canSubmit = communication != null && quality != null && speed != null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Rating</div>
          <div className="text-xs text-muted-foreground">
            BD only. One-time on first completion.
          </div>
        </div>

        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Rate project"}
        </Button>
      </div>

      {open ? (
        <form className="mt-4 space-y-5" action={createProjectRating}>
          <input type="hidden" name="projectId" value={projectId} />

          {/* Hidden inputs that server action expects */}
          <input type="hidden" name="communication" value={communication ?? ""} />
          <input type="hidden" name="quality" value={quality ?? ""} />
          <input type="hidden" name="speed" value={speed ?? ""} />
          <input type="hidden" name="professionalism" value={professionalism ?? ""} />

          <div className="grid gap-5 md:grid-cols-3">
            <StarRow
              label="Communication"
              value={communication}
              onChange={setCommunication}
              required
            />
            <StarRow label="Quality" value={quality} onChange={setQuality} required />
            <StarRow label="Speed" value={speed} onChange={setSpeed} required />
          </div>

          <div className="max-w-md">
            <StarRow
              label="Professionalism"
              value={professionalism}
              onChange={setProfessionalism}
              required={false}
              hint="Optional"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={!canSubmit}>
              Submit rating
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {!canSubmit ? (
            <div className="text-xs text-muted-foreground">
              Select stars for Communication, Quality, and Speed to enable submit.
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
