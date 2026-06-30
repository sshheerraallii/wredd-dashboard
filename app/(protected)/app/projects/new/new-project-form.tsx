// app/(protected)/app/projects/new/new-project-form.tsx
"use client";

import * as React from "react";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject } from "../actions";

type Department = { id: string; name: string };
type Portal = "UPWORK" | "FIVERR" | "DIRECT" | "OTHER";

type FeePreset = "UPWORK_10P" | "FIVERR_20P" | "DIRECT_5P" | "CUSTOM";

function numOrNull(v: string) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function fmt2(n: number) {
  return n.toFixed(2);
}

export default function NewProjectForm({ departments }: { departments: Department[] }) {
  const [departmentId, setDepartmentId] = React.useState("");

  const [clientName, setClientName] = React.useState("");
  const [clientUsername, setClientUsername] = React.useState("");

  const [portal, setPortal] = React.useState<Portal>("UPWORK");
  const [priceUsd, setPriceUsd] = React.useState("");
  const [isSample, setIsSample] = React.useState(false);

  // percent-based
  const [feePreset, setFeePreset] = React.useState<FeePreset>("UPWORK_10P");
  const [customFeePercent, setCustomFeePercent] = React.useState("");

  const platformFeePercent = React.useMemo(() => {
    if (feePreset === "CUSTOM") {
      const n = numOrNull(customFeePercent);
      if (n == null) return "";
      return fmt2(clamp(n, 0, 100));
    }
    if (feePreset === "UPWORK_10P") return "10.00";
    if (feePreset === "DIRECT_5P") return "5.00";
    if (feePreset === "FIVERR_20P") return "20.00";
    return "";
  }, [feePreset, customFeePercent]);

  const computedFeeUsd = React.useMemo(() => {
    const price = numOrNull(priceUsd);
    const pct = numOrNull(platformFeePercent);
    if (price == null || pct == null) return "";
    if (price <= 0 || pct < 0) return "";
    return fmt2((price * pct) / 100);
  }, [priceUsd, platformFeePercent]);

  const canSubmit = departmentId.length > 0;
  const [pending, start] = useTransition();

  return (
    <form className="max-w-2xl space-y-6" action={(fd: FormData) => start(async () => { await createProject(fd); })}>
      {/* Hidden inputs for Select/state-driven fields */}
      <input type="hidden" name="departmentId" value={departmentId} />
      <input type="hidden" name="portal" value={portal} />
      <input type="hidden" name="isSample" value={String(isSample)} />
      {/* ✅ store percent in DB */}
      <input type="hidden" name="platformFeePercent" value={platformFeePercent} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Client name</label>
          <Input
            name="clientName"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g., York City Institute"
          />
          <p className="text-xs text-muted-foreground">
            Only visible to BD / Manager / Super Admin.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Client username</label>
          <Input
            name="clientUsername"
            value={clientUsername}
            onChange={(e) => setClientUsername(e.target.value)}
            placeholder="e.g., @yorkcityii"
          />
          <p className="text-xs text-muted-foreground">
            Only visible to BD / Manager / Super Admin.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Title</label>
        <Input name="title" placeholder="e.g., 30s product promo edit" autoFocus />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Textarea
          name="description"
          placeholder="Add brief requirements, style references, notes…"
          rows={5}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Department</label>

        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger>
            <SelectValue placeholder="Select department" />
          </SelectTrigger>

          <SelectContent>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          Projects must have exactly one department.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">Financial details (USD)</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Used for commission and monthly finance calculations.
          </div>
        </div>

        {/* Sample toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isSample}
            onChange={(e) => setIsSample(e.target.checked)}
            className="h-4 w-4 rounded border accent-red-700"
          />
          <span className="text-sm font-medium">This is a sample / unpaid project</span>
          <span className="text-xs text-muted-foreground">
            No price, no BD commission, no worker payment lines.
          </span>
        </label>

        {!isSample && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Portal</label>
                <Select value={portal} onValueChange={(v) => setPortal(v as Portal)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select portal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UPWORK">Upwork</SelectItem>
                    <SelectItem value="FIVERR">Fiverr</SelectItem>
                    <SelectItem value="DIRECT">Direct</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Price (USD) *</label>
                <Input
                  name="priceUsd"
                  inputMode="decimal"
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(e.target.value)}
                  placeholder="e.g., 250"
                />
                <p className="text-xs text-muted-foreground">Required.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Platform fee</label>
                <Select value={feePreset} onValueChange={(v) => setFeePreset(v as FeePreset)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select platform fee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UPWORK_10P">Upwork (10%)</SelectItem>
                    <SelectItem value="FIVERR_20P">Fiverr (20%)</SelectItem>
                    <SelectItem value="DIRECT_5P">Direct (5%)</SelectItem>
                    <SelectItem value="CUSTOM">Custom (%)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Stored as a percentage (e.g., 20.00).
                </p>
              </div>

              {feePreset === "CUSTOM" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Custom platform fee (%)</label>
                  <Input
                    inputMode="decimal"
                    value={customFeePercent}
                    onChange={(e) => setCustomFeePercent(e.target.value)}
                    placeholder="e.g., 20"
                  />
                  <p className="text-xs text-muted-foreground">0 to 100.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Computed fee (USD)</label>
                  <Input value={computedFeeUsd || "—"} readOnly />
                  <p className="text-xs text-muted-foreground">
                    Based on Price × Fee%.
                  </p>
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Stored fee%: <span className="font-medium">{platformFeePercent || "—"}</span>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Deadline (hours)</label>
        <Input type="number" min={0} step={1} name="deadlineHours" placeholder="e.g., 72" />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => history.back()}>
          Cancel
        </Button>

        <Button type="submit" disabled={!canSubmit || pending}>
          {pending ? "Saving…" : "Save Project"}
        </Button>
      </div>
    </form>
  );
}