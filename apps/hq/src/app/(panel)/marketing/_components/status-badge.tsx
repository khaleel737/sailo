import { Badge } from "@sailo/design-system/web";
import type { NewsletterStatus } from "@sailo/marketing/newsletter";

/**
 * A campaign's status, coloured the same way wherever it appears.
 *
 * This was two copies of one map — in the list and on the campaign's own page
 * — which is the shape that goes wrong quietly: a sixth status added to the
 * pipeline shows as a grey chip on one screen and the right colour on the
 * other, and nothing fails.
 *
 * Typed on `NewsletterStatus` rather than on `string`, so the map is the thing
 * that breaks when the pipeline gains a state.
 */
const TONES: Record<NewsletterStatus, "neutral" | "blue" | "amber" | "green"> = {
  draft: "neutral",
  scheduled: "blue",
  // Queuing and sending are one colour on purpose: the difference between
  // "building the list" and "working through it" is a distinction the pipeline
  // cares about and a reader does not — both mean "in flight, do not edit".
  queuing: "amber",
  sending: "amber",
  sent: "green",
};

export function CampaignStatus({ status }: { status: string }) {
  /*
   * `status` is `string` because that is what the column is. A row written by
   * a future version of the pipeline should render as itself in a neutral
   * chip rather than crash a list of forty campaigns.
   */
  const tone = TONES[status as NewsletterStatus] ?? "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
