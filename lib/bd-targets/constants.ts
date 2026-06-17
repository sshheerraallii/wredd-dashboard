// lib/bd-targets/constants.ts
// Locked model: 1 point = $6 always. Price is treated as truth.

export const DOLLARS_PER_POINT = 6 as const;

// Hardcoded department <-> onsite worker-type mapping (matches seed naming).
export type DeptKey = "animations" | "video-editing";

export const DEPT_DEFS: {
  key: DeptKey;
  name: string;
  altSlug: string;
  workerType: "ONSITE_ANIMATOR" | "ONSITE_VIDEO_EDITOR";
}[] = [
  { key: "animations", name: "Animations", altSlug: "animations", workerType: "ONSITE_ANIMATOR" },
  { key: "video-editing", name: "Video Editing", altSlug: "video-editing", workerType: "ONSITE_VIDEO_EDITOR" },
];

// In-production statuses (Active bucket). Backlog = UNASSIGNED. Excluded: COMPLETED, CANCELLED.
export const ACTIVE_STATUSES = ["IN_PROGRESS", "REVISION", "DELIVERED"] as const;

export const DEFAULT_WORKING_DAYS = 25;
