/**
 * What a sweep can do, and what it costs to be allowed to do it.
 *
 * ─── WHY THIS IS NOT IN `actions/bulk.ts` ────────────────────────────────────
 * It was, and the build refused it — with an error worth writing down, because
 * `tsc` is completely happy with the broken version and the failure only
 * appears at bundle time:
 *
 *     The export bulkAccountAction was not found in module .../actions/bulk.ts
 *     The module has no exports at all.
 *
 * A `"use server"` module may export **async functions and nothing else**. Every
 * export becomes a callable HTTP endpoint, and a `const` cannot be one — so a
 * single non-function export does not merely fail to be exported, it
 * invalidates the whole module and the action beside it disappears too. The
 * bar renders, the button posts, and nothing is there to receive it.
 *
 * So the vocabulary lives here, in an ordinary module both sides may import,
 * and `actions/bulk.ts` exports exactly one thing: the action.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { StaffCapability } from "@sailo/security/staff";

/**
 * How many shops one sweep may touch.
 *
 * A hundred is roughly "four pages of the accounts list", which is as much as
 * anybody has actually looked at before pressing a button. It is also small
 * enough that the batched statement and the per-shop cache work stay inside a
 * request without needing a queue — and the day this needs a queue is the day
 * it needs a different design, not a bigger number.
 */
export const BULK_LIMIT = 100;

/**
 * Each operation, with the capability it needs and the verb the audit row uses.
 *
 * The capability on each line is the same one the single-shop action checks —
 * see `actions/standing.ts` and `actions/notes.ts`. That is the property worth
 * preserving: the bulk path must never be a way to do by forty what the other
 * files will not let you do by one.
 *
 * `destructive` decides only which colour the button is. It is not a security
 * property and nothing reads it server-side.
 */
export const BULK_OPERATIONS = {
  suspend: {
    capability: "account:suspend",
    verb: "Suspended",
    label: "Suspend",
    destructive: true,
  },
  unsuspend: {
    capability: "account:suspend",
    verb: "Lifted the suspension on",
    label: "Lift suspension",
    destructive: false,
  },
  pause_marketing: {
    capability: "account:suspend",
    verb: "Paused marketing for",
    label: "Pause marketing",
    destructive: true,
  },
  resume_marketing: {
    capability: "account:suspend",
    verb: "Let marketing resume for",
    label: "Let marketing resume",
    destructive: false,
  },
  comp: {
    capability: "billing:grant",
    verb: "Comped",
    label: "Comp a plan",
    destructive: false,
  },
  clear_comp: {
    capability: "billing:grant",
    verb: "Removed the comp from",
    label: "Remove the comp",
    destructive: true,
  },
  note: {
    capability: "notes:write",
    verb: "Noted on",
    label: "Append an internal note",
    destructive: false,
  },
} as const satisfies Record<
  string,
  {
    capability: StaffCapability;
    verb: string;
    label: string;
    destructive: boolean;
  }
>;

export type BulkOperation = keyof typeof BULK_OPERATIONS;

export function isBulkOperation(value: unknown): value is BulkOperation {
  return typeof value === "string" && value in BULK_OPERATIONS;
}

/** Ordered for the menu: the reversible ones first, the loudest last. */
export const BULK_OPERATION_ORDER = [
  "note",
  "unsuspend",
  "resume_marketing",
  "comp",
  "clear_comp",
  "pause_marketing",
  "suspend",
] as const satisfies readonly BulkOperation[];
