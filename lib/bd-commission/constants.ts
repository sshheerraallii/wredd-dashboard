// lib/bd-commission/constants.ts
// LOCKED MODEL (Mini-Step 0 scope)
// - Tabs: Active / Clearing / Due / Paid
// - Due on 1st, Payable on 10th
// - WorkType: ONSITE | REMOTE
// - System BD identity key

export const DUE_DAY = 1 as const;
export const PAYABLE_DAY = 10 as const;

export const COMMISSION_TABS = ["ACTIVE", "CLEARING", "DUE", "PAID"] as const;
export type CommissionTab = (typeof COMMISSION_TABS)[number];

export const WORK_TYPES = ["ONSITE", "REMOTE"] as const;
export type BdWorkType = (typeof WORK_TYPES)[number];

// Used as username for the system BD user (unique in your schema)
export const SYSTEM_BD_KEY = "WREDD_BD" as const;

// Stable internal email for system user (unique in your schema)
// (You can change to a real domain later, but keep it stable once chosen)
export const SYSTEM_BD_EMAIL = "wredd_bd@wredd.local" as const;