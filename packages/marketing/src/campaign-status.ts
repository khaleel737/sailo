/**
 * A campaign's status, coloured the same way wherever it appears.
 *
 * One map for both send pipelines — a seller's broadcasts and Sailo's own
 * newsletter — because they share the vocabulary, and drifted copies are how
 * a sixth status shows as a grey chip on one screen and the right colour on
 * the other with nothing failing. HQ's badge had already buried one
 * duplicate of this map ("this was two copies of one map"); the cross-app
 * copy in the seller's broadcasts page recreated it.
 *
 * `NEWSLETTER_STATUSES` in `./newsletter/list.ts` is pinned to this list by
 * the `satisfies` below: a status added to either pipeline breaks the build
 * here, which is the failure mode a colour map wants.
 */

import { NEWSLETTER_STATUSES } from "./newsletter/list";

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "queuing",
  "sending",
  "sent",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/* The newsletter pipeline speaks exactly this vocabulary — see above. */
NEWSLETTER_STATUSES satisfies readonly CampaignStatus[];

export type CampaignTone = "neutral" | "blue" | "amber" | "green";

export const CAMPAIGN_STATUS_TONES: Record<CampaignStatus, CampaignTone> = {
  draft: "neutral",
  scheduled: "blue",
  // Queuing and sending are one colour on purpose: the difference between
  // "building the list" and "working through it" is a distinction the
  // pipeline cares about and a reader does not — both mean "in flight, do
  // not edit".
  queuing: "amber",
  sending: "amber",
  sent: "green",
};

/** The tone for a status — neutral for one this build has never heard of,
 *  so a row written by a future pipeline renders as itself in a grey chip
 *  rather than crashing a list of forty campaigns. */
export function campaignTone(status: string): CampaignTone {
  return (CAMPAIGN_STATUS_TONES as Record<string, CampaignTone>)[status] ?? "neutral";
}
