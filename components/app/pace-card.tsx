import type { ReactNode } from "react";
import { buildPaceQueue, type PaceLine } from "@/lib/onsite-points/pace";

/**
 * Delivery Pace Card — onsite worker dashboard.
 *
 * Forward-looking daily plan: what to ship next and by when to stay on pace for
 * 100% monthly accuracy. Behind-state (blood-red / primary token) is driven by
 * projected accuracy, not by the pace dates. Renders nothing for non-onsite users
 * or anyone without a set monthly target.
 */
export async function PaceCard({ userId }: { userId: string }) {
  const pace = await buildPaceQueue(userId);
  if (!pace.eligible) return null;

  const acc = pace.projectedAccuracy;
  const behind = acc == null || acc < 100;

  const banner =
    acc == null
      ? "You're just getting started this month — deliver your active work on time to build toward 100%."
      : behind
      ? `You're tracking at ${acc}%. Deliver your active work on time to pull this back to 100%.`
      : `You're on pace at ${acc}%. Keep it up.`;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Your delivery pace</h2>
        {acc != null ? (
          <span
            className={
              "text-xs font-medium " +
              (behind ? "text-primary" : "text-muted-foreground")
            }
          >
            {acc}% projected
          </span>
        ) : null}
      </div>

      <p className={"text-sm " + (behind ? "text-primary" : "text-muted-foreground")}>
        {banner}
      </p>

      {pace.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active projects right now — check the Unassigned tab for work you can pick up.
        </p>
      ) : (
        <ul className="space-y-2">
          {pace.lines.map((line) => (
            <PaceRow key={line.projectId} line={line} />
          ))}
        </ul>
      )}

      {pace.underload ? (
        <p className="text-xs text-muted-foreground">
          That&apos;s about {pace.totalWorkHours}h of work — under a full day. You&apos;ll
          want to pick up more soon.
        </p>
      ) : null}
    </div>
  );
}

function PaceRow({ line }: { line: PaceLine }) {
  const urgent = line.kind === "REVISION_URGENT";
  const muted = line.kind === "AWAITING_HOURS";
  const day = line.dayLabel ?? "";
  const title = <span className="font-medium text-foreground">{line.title}</span>;
  const when = <span className="font-medium text-foreground">{day}</span>;

  let body: ReactNode;
  if (line.kind === "AWAITING_HOURS") {
    body = <>{title} — hours not set yet; check with ops.</>;
  } else if (line.kind === "REVISION_URGENT") {
    body = <>{title} — deliver the revision today.</>;
  } else if (line.kind === "REVISION") {
    body =
      day === "today" ? (
        <>Ship the revision on {title} by end of today.</>
      ) : (
        <>Ship the revision on {title} by end of {when}.</>
      );
  } else {
    // FIRST_PASS
    body =
      day === "today" ? (
        <>{title} is due by end of today.</>
      ) : (
        <>Deliver the first version of {title} by end of {when}.</>
      );
  }

  return (
    <li className="flex items-start gap-2.5">
      <span
        className={
          "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full " +
          (urgent ? "bg-primary" : "bg-muted-foreground/40")
        }
        aria-hidden
      />
      <span
        className={
          "text-sm " +
          (urgent ? "text-primary" : muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {body}
      </span>
    </li>
  );
}
