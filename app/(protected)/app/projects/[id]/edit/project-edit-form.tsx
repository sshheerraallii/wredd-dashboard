// app/(protected)/app/projects/[id]/edit/project-edit-form.tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProject, deleteProject } from "./actions";

type Dept = { id: string; name: string };

type FinanceProps = {
  priceUsd: string;
  platformFeePercent: string;
  portal: string;
  clientName: string;
  clientUsername: string;
};

export default function EditProjectForm(props: {
  project: {
    id: string;
    title: string;
    description: string | null;
    departmentId: string;
    deadlineHours: number;
  };
  departments: Dept[];
  finance: FinanceProps;
  isSample: boolean;
  financeEditable: boolean;
}) {
  const { project, departments, finance, financeEditable } = props;
  const [pending, start] = useTransition();
  const [confirmText, setConfirmText] = useState("");

  // Finance state (only used when editable)
  const [isSample, setIsSample] = useState(props.isSample);
  const [priceUsd, setPriceUsd] = useState(finance.priceUsd);
  const [platformFeePercent, setPlatformFeePercent] = useState(finance.platformFeePercent);
  const [clientName, setClientName] = useState(finance.clientName);
  const [clientUsername, setClientUsername] = useState(finance.clientUsername);

  return (
    <div className="rounded-xl border bg-background p-4 space-y-4">
      <form
        action={(fd) => start(async () => updateProject(fd))}
        className="space-y-3"
      >
        <input type="hidden" name="id" value={project.id} />

        <div className="grid gap-2">
          <label className="text-sm font-medium">Title</label>
          <Input name="title" defaultValue={project.title} required />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Description</label>
          <textarea
            name="description"
            defaultValue={project.description ?? ""}
            className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Department</label>
          <select
            name="departmentId"
            defaultValue={project.departmentId}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            required
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Deadline (hours)</label>
          <Input
            name="deadlineHours"
            type="number"
            min={1}
            step={1}
            defaultValue={project.deadlineHours}
            required
          />
        </div>

        {/* Finance */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Finance</div>
            {!financeEditable && (
              <span className="text-xs text-muted-foreground">
                Locked — project has been completed
              </span>
            )}
          </div>

          {financeEditable ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isSample}
                  onChange={(e) => setIsSample(e.target.checked)}
                />
                Sample project (no price, excluded from BD commission &amp; finance)
              </label>
              <input type="hidden" name="isSample" value={String(isSample)} />

              {!isSample && (
                <>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Portal</label>
                    <select
                      name="portal"
                      defaultValue={finance.portal}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="UPWORK">Upwork</option>
                      <option value="FIVERR">Fiverr</option>
                      <option value="DIRECT">Direct</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Price (USD)</label>
                      <Input
                        name="priceUsd"
                        inputMode="decimal"
                        placeholder="e.g., 250"
                        value={priceUsd}
                        onChange={(e) => setPriceUsd(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Platform fee (%)</label>
                      <Input
                        name="platformFeePercent"
                        inputMode="decimal"
                        placeholder="e.g., 20"
                        value={platformFeePercent}
                        onChange={(e) => setPlatformFeePercent(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Client name</label>
                  <Input
                    name="clientName"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Client username</label>
                  <Input
                    name="clientUsername"
                    value={clientUsername}
                    onChange={(e) => setClientUsername(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground space-y-1">
              <div>Portal: {finance.portal}</div>
              <div>Price (USD): {finance.priceUsd || "—"}</div>
              <div>Platform fee (%): {finance.platformFeePercent || "—"}</div>
              <div>
                Client: {finance.clientName || "—"}
                {finance.clientUsername ? ` (${finance.clientUsername})` : ""}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save Changes"}
          </Button>

          <Button asChild variant="secondary" disabled={pending}>
            <Link href={`/app/projects/${project.id}`}>Cancel</Link>
          </Button>
        </div>
      </form>

      <div className="border-t pt-4">
        <div className="text-sm font-medium">Danger Zone</div>
        <div className="text-xs text-muted-foreground">
          Type <span className="font-mono">DELETE</span> to enable delete.
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
            className="max-w-[220px]"
          />

          <form action={(fd) => start(async () => deleteProject(fd))}>
            <input type="hidden" name="id" value={project.id} />
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || confirmText !== "DELETE"}
            >
              Delete Project
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
