import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { buildPaceQueueForUsers, type PaceResult, type PaceLine } from "@/lib/onsite-points/pace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const prisma = getPrisma();

type Discipline = "ANIMATOR" | "VIDEO_EDITOR" | "OTHER";
type Status = "BEHIND" | "NEEDS_SETUP" | "CAPACITY" | "STARTING" | "ON_TRACK";

const STATUS_ORDER: Record<Status, number> = {
  BEHIND: 0,
  NEEDS_SETUP: 1,
  CAPACITY: 2,
  STARTING: 2,
  ON_TRACK: 3,
};

function classify(pace: PaceResult): Status {
  if (!pace.eligible) return "NEEDS_SETUP";
  if (pace.projectedAccuracy == null) return "STARTING";
  if (pace.projectedAccuracy < 100) return "BEHIND";
  if (pace.lines.length === 0 || pace.underload) return "CAPACITY";
  return "ON_TRACK";
}

function statusPill(status: Status, acc: number | null): string {
  switch (status) {
    case "BEHIND":
      return `${acc}% · behind`;
    case "NEEDS_SETUP":
      return "No target set";
    case "CAPACITY":
      return acc != null ? `${acc}% · has capacity` : "Has capacity";
    case "STARTING":
      return "Just starting";
    case "ON_TRACK":
      return `${acc}% · on track`;
  }
}

function nextDueLabel(pace: PaceResult): string {
  const dated = pace.lines.filter((l) => l.targetDate != null);
  if (dated.length === 0) return "—";
  let soonest = dated[0];
  for (const l of dated) {
    if (l.targetDate! < soonest.targetDate!) soonest = l;
  }
  return soonest.dayLabel ?? "—";
}

function activeCount(pace: PaceResult): number {
  return pace.lines.filter((l) => l.kind !== "AWAITING_HOURS").length;
}

function lineText(line: PaceLine): string {
  const day = line.dayLabel ?? "";
  const today = day === "today";
  switch (line.kind) {
    case "AWAITING_HOURS":
      return `${line.title} — hours not set`;
    case "REVISION_URGENT":
      return `Revision of ${line.title} — expected today`;
    case "REVISION":
      return today
        ? `Revision of ${line.title} — expected today`
        : `Revision of ${line.title} — expected by ${day}`;
    case "FIRST_PASS":
      return today
        ? `First version of ${line.title} — expected today`
        : `First version of ${line.title} — expected by ${day}`;
  }
}

export default async function PacePage() {
  const session = await readSession();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  const viewerId = session.user.id;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "BUSINESS_DEVELOPER") {
    redirect("/app");
  }

  const workers = await prisma.user.findMany({
    where: { role: "ONSITE_EMPLOYEE", archivedAt: null },
    select: { id: true, fullName: true, workerType: true },
    orderBy: { fullName: "asc" },
  });

  // BD viewers get a "Your project" badge on lines for projects they own.
  const bdProjectIds = new Set<string>();
  if (role === "BUSINESS_DEVELOPER") {
    const owned = await prisma.project.findMany({
      where: { bdOwnerId: viewerId },
      select: { id: true },
    });
    for (const p of owned) bdProjectIds.add(p.id);
  }

  const paceMap = await buildPaceQueueForUsers(workers.map((w) => w.id));

  type Row = {
    id: string;
    fullName: string;
    discipline: Discipline;
    pace: PaceResult;
    status: Status;
  };

  const rows: Row[] = workers.map((w) => {
    const pace =
      paceMap.get(w.id) ?? {
        eligible: false,
        projectedAccuracy: null,
        lines: [],
        totalWorkHours: 0,
        underload: false,
      };
    const discipline: Discipline =
      w.workerType === "ONSITE_ANIMATOR"
        ? "ANIMATOR"
        : w.workerType === "ONSITE_VIDEO_EDITOR"
        ? "VIDEO_EDITOR"
        : "OTHER";
    return { id: w.id, fullName: w.fullName, discipline, pace, status: classify(pace) };
  });

  const groups: { key: Discipline; title: string }[] = [
    { key: "ANIMATOR", title: "Animators" },
    { key: "VIDEO_EDITOR", title: "Video Editors" },
    { key: "OTHER", title: "Other" },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Pace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What each onsite worker is currently being asked to deliver — so you know
          what to expect. Sorted so anyone needing attention is at the top.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No onsite workers yet.</p>
      ) : (
        groups.map((g) => {
          const groupRows = rows
            .filter((r) => r.discipline === g.key)
            .sort(
              (a, b) =>
                STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
                a.fullName.localeCompare(b.fullName)
            );
          if (groupRows.length === 0) return null;
          return (
            <section key={g.key} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {g.title}{" "}
                <span className="font-normal">({groupRows.length})</span>
              </h2>
              <div className="space-y-2">
                {groupRows.map((r) => (
                  <WorkerRow key={r.id} row={r} bdProjectIds={bdProjectIds} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function WorkerRow({
  row,
  bdProjectIds,
}: {
  row: {
    id: string;
    fullName: string;
    pace: PaceResult;
    status: Status;
  };
  bdProjectIds: Set<string>;
}) {
  const { pace, status } = row;
  const attention = status === "BEHIND" || status === "NEEDS_SETUP";
  const behind = status === "BEHIND";
  const count = activeCount(pace);

  return (
    <details
      open={attention}
      className="rounded-lg border bg-card px-4 py-3"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={
              "h-2 w-2 flex-shrink-0 rounded-full " +
              (behind ? "bg-primary" : "bg-muted-foreground/40")
            }
            aria-hidden
          />
          <span className="truncate font-medium text-foreground">{row.fullName}</span>
          <span
            className={
              "flex-shrink-0 rounded-full border px-2 py-0.5 text-xs " +
              (behind ? "border-primary/40 text-primary" : "text-muted-foreground")
            }
          >
            {statusPill(status, pace.projectedAccuracy)}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4 text-xs text-muted-foreground">
          <span>{count} active</span>
          <span>next: {nextDueLabel(pace)}</span>
        </div>
      </summary>

      <div className="mt-3 border-t pt-3">
        {pace.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {status === "NEEDS_SETUP"
              ? "No monthly target set — pace can't be tracked until it is."
              : "No active projects right now."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pace.lines.map((line) => {
              const urgent = line.kind === "REVISION_URGENT";
              const muted = line.kind === "AWAITING_HOURS";
              return (
                <li
                  key={line.projectId}
                  className={
                    "text-sm " +
                    (urgent
                      ? "text-primary"
                      : muted
                      ? "text-muted-foreground"
                      : "text-foreground")
                  }
                >
                  {lineText(line)}
                  {bdProjectIds.has(line.projectId) ? (
                    <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Your project
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
