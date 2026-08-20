import { Badge } from "@sailo/design-system/web";
import { campaignTone } from "@sailo/marketing/campaign-status";

/*
 * A campaign's status, coloured the same way wherever it appears — the map
 * itself lives beside the vocabulary in `@sailo/marketing/campaign-status`,
 * shared with the seller's broadcasts page. This file once held the second
 * of two in-app copies; the cross-app copy was the third.
 */

export function CampaignStatus({ status }: { status: string }) {
  /*
   * `status` is `string` because that is what the column is. A row written by
   * a future version of the pipeline should render as itself in a neutral
   * chip rather than crash a list of forty campaigns.
   */
  return <Badge tone={campaignTone(status)}>{status}</Badge>;
}
